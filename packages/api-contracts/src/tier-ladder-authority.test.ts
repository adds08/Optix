import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@stinventory/db";
import * as schema from "@stinventory/db/schema";
import type { Permission } from "@stinventory/types";
import { appRouter } from "./index.js";
import type { Context } from "./trpc.js";

const url = process.env.DATABASE_URL;

/*
  PATH 4 AT THE WRITE GATE, not just in the hint.

  `canAssignIntoTier` is unit-tested next door and proves the combination. This
  suite proves the thing that actually matters in production: that
  `assertCanAssign` — the real refusal — resolves the ancestor set the same way
  `projectTeams.workspace` does when it builds the `assignable` list the picker
  renders.

  The two are computed by different code against different shapes (one queries
  per call, the other walks a register already in memory), so they CAN drift.
  A picker that offers a tier the write then refuses is worse than one that
  never offered it, which is why this asserts both halves for the same actor.

  Ladder built here, mirroring Urban's:

    Director -> Area In-charge -> Superintendent -> Foreman
                             \-> Project Manager

  and one "Set by" row: Superintendent may set Foreman.
*/
describe.skipIf(!url)("a tier may be set by everyone above it", () => {
  let db: ReturnType<typeof createDb>;
  let tid: string;
  let adminUser: string;
  let directorUser: string, directorEmp: string;
  let superUser: string, superEmp: string;
  let hand: string;
  let projectId: string;

  const caller = (userId: string, employeeId: string | null, permissions: Permission[]) =>
    appRouter.createCaller({
      db,
      session: { userId, tenantId: tid, employeeId, permissions: new Set(permissions), roleName: null, actorLabel: "Ladder test" },
      sessionSecret: "ladder-test",
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    } satisfies Context);

  /* No `project.team.assign` — that is path 1 and would short-circuit
     everything this suite exists to test. */
  const asDirector = () => caller(directorUser, directorEmp, ["project.team.read", "assets.view.project"]);
  const asSuper = () => caller(superUser, superEmp, ["project.team.read", "assets.view.project"]);

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db.insert(schema.tenant).values({ name: "Ladder", slug: `ladder-${crypto.randomUUID()}` }).returning();
    tid = t!.id;

    const tiers = await db.insert(schema.teamRole).values([
      { tenantId: tid, name: "director", label: "Director" },
      { tenantId: tid, name: "area_in_charge", label: "Area In-charge" },
      { tenantId: tid, name: "superintendent", label: "Superintendent" },
      { tenantId: tid, name: "pm", label: "Project Manager" },
      { tenantId: tid, name: "foreman", label: "Foreman", canHoldCustody: true },
    ]).returning();
    const tier = (n: string) => tiers.find(x => x.name === n)!;
    /* The ladder. This is the ONLY thing that makes a Director able to set a
       Foreman — there is no Set-by row saying so. */
    await db.update(schema.teamRole).set({ reportsToTeamRoleId: tier("director").id }).where(eq(schema.teamRole.id, tier("area_in_charge").id));
    await db.update(schema.teamRole).set({ reportsToTeamRoleId: tier("area_in_charge").id }).where(eq(schema.teamRole.id, tier("superintendent").id));
    await db.update(schema.teamRole).set({ reportsToTeamRoleId: tier("area_in_charge").id }).where(eq(schema.teamRole.id, tier("pm").id));
    await db.update(schema.teamRole).set({ reportsToTeamRoleId: tier("superintendent").id }).where(eq(schema.teamRole.id, tier("foreman").id));
    await db.insert(schema.teamRoleAssigner).values({ teamRoleId: tier("foreman").id, assignerTeamRoleId: tier("superintendent").id });

    const emps = await db.insert(schema.employee).values(
      ["Dana Director", "Sam Super", "Hank Hand"].map(name => ({ tenantId: tid, name, employmentStatus: "active" })),
    ).returning();
    [directorEmp, superEmp, hand] = emps.map(e => e.id) as [string, string, string];

    const mk = async (email: string, employeeId: string | null) => {
      const [u] = await db.insert(schema.user).values({ tenantId: tid, employeeId, email: `${email}-${tid}@test.local`, firstName: "T", lastName: "T", passwordHash: "unused" }).returning();
      return u!.id;
    };
    adminUser = await mk("admin", null);
    directorUser = await mk("director", directorEmp);
    superUser = await mk("super", superEmp);

    const [proj] = await db.insert(schema.project).values({ tenantId: tid, name: "Ladder Job", status: "in_progress", startDate: "2026-01-01" }).returning();
    projectId = proj!.id;

    /* The director onto the job, by an admin — this suite is about what SHE can
       do next, not about how she got there. */
    await caller(adminUser, null, ["project.team.assign", "project.team.read"])
      .projectTeam.assign({ projectId, employeeId: directorEmp, role: "director", source: "manual_entry" });
  });

  afterAll(async () => {
    if (tid) await db.delete(schema.tenant).where(eq(schema.tenant.id, tid));
  });

  it("WRITE: a Director may place a Foreman, though no Set-by row says so", async () => {
    /* The reported bug. Foreman's only Set-by is Superintendent; the Director
       gets there purely by being above it on the ladder. */
    await asDirector().projectTeam.assign({ projectId, employeeId: hand, role: "foreman", source: "manual_entry" });
    const row = await db.query.projectTeamMember.findFirst({
      where: eq(schema.projectTeamMember.employeeId, hand),
    });
    expect(row?.role).toBe("foreman");
  });

  it("HINT: the picker offers exactly what the write accepts", async () => {
    /* The drift guard. `assignable` is built by a different code path from
       `assertCanAssign`, and the two must agree — the previous test proved the
       write, this proves the list the person is shown. */
    const ws = await asDirector().projectTeams.workspace();
    const job = ws.projects.find(p => p.id === projectId)!;
    expect(job.assignable).toContain("foreman");
    expect(job.assignable).toContain("area_in_charge");
    expect(job.assignable).toContain("pm");
  });

  it("WRITE: a Superintendent still may NOT place a PM", async () => {
    /* The property that keeps this a hierarchy rather than a free-for-all: a
       Superintendent is neither above a PM on the ladder nor in its Set-by. */
    await caller(adminUser, null, ["project.team.assign", "project.team.read"])
      .projectTeam.assign({ projectId, employeeId: superEmp, role: "superintendent", source: "manual_entry" });
    await expect(
      asSuper().projectTeam.assign({ projectId, employeeId: hand, role: "pm", source: "manual_entry" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("HINT: and the picker does not offer it either", async () => {
    const ws = await asSuper().projectTeams.workspace();
    const job = ws.projects.find(p => p.id === projectId)!;
    expect(job.assignable).not.toContain("pm");
    /* Still offers what it legitimately can, so this is not simply an empty
       list passing the assertion above. */
    expect(job.assignable).toContain("foreman");
  });

  it("reports who CAN set a tier, for the disabled option's reason", async () => {
    /* The picker renders `setBy` as the explanation on a tier you cannot
       choose, so it must name the same union the gate uses — Set-by plus the
       ladder — or the screen would explain a rule the write does not follow. */
    const ws = await asSuper().projectTeams.workspace();
    const pm = ws.tiers.find(t => t.name === "pm")!;
    expect(pm.setBy).toEqual(expect.arrayContaining(["Area In-charge", "Director"]));
    expect(pm.setBy).not.toContain("Superintendent");
  });
});
