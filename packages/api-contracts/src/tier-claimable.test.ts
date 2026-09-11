import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb } from "@stinventory/db";
import * as schema from "@stinventory/db/schema";
import type { Permission } from "@stinventory/types";
import { appRouter } from "./index.js";
import type { Context } from "./trpc.js";

const url = process.env.DATABASE_URL;

/*
  `projectTeam.roles.setClaimable` — the "Can claim a job" toggle on the Job
  Tiers screen.

  What makes this worth its own suite is that the control and the data are on
  DIFFERENT TABLES. The administrator ticks a TIER (`team_role`), and the write
  lands on the LOGIN ROLE of the same name (`role.claimTierNames`). Every test
  here is really asking one question: does the indirection hold, and does it
  fail honestly when there is nothing on the other side of it?

  Isolated tenant, torn down afterwards — the earlier version of a neighbouring
  suite left an orphan tenant per run in the same database the dev stack uses.
*/
describe.skipIf(!url)("turning self-claiming on for a tier", () => {
  let db: ReturnType<typeof createDb>;
  let tenantId: string;
  let userId: string;
  let directorTierId: string;
  let orphanTierId: string;
  let directorRoleId: string;
  let pmTierId: string;
  let pmRoleId: string;

  const caller = (permissions: Permission[]) =>
    appRouter.createCaller({
      db,
      session: {
        userId,
        tenantId,
        employeeId: null,
        permissions: new Set(permissions),
        roleName: null,
        actorLabel: "Tier claim test",
      },
      sessionSecret: "tier-claimable-test",
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    } satisfies Context);

  const admin = () => caller(["config.manage", "project.team.manage", "project.team.read"]);

  const claimTiersOf = async (roleId: string) => {
    const [row] = await db
      .select({ claimTierNames: schema.role.claimTierNames })
      .from(schema.role)
      .where(eq(schema.role.id, roleId));
    return row?.claimTierNames ?? [];
  };

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "Tier claim", slug: `tier-claim-${crypto.randomUUID()}` })
      .returning();
    tenantId = t!.id;

    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: `claim-${tenantId}@test.local`, firstName: "A", lastName: "B", passwordHash: "unused" })
      .returning();
    userId = u!.id;

    /* A tier WITH a login role of the same name, and one WITHOUT. The second is
       the interesting fixture: a tenant may invent a tier on this screen, and
       nothing creates a login role to match.

       `pm` is the third and the awkward one — the ONE seeded tier whose name
       does not match its login role. It is reproduced here rather than assumed,
       because the whole point is that the two registers spell it differently. */
    const tiers = await db
      .insert(schema.teamRole)
      .values([
        { tenantId, name: "director", label: "Director" },
        { tenantId, name: "site_marshal", label: "Site Marshal" },
        { tenantId, name: "pm", label: "Project Manager" },
      ])
      .returning();
    directorTierId = tiers.find((r) => r.name === "director")!.id;
    orphanTierId = tiers.find((r) => r.name === "site_marshal")!.id;
    pmTierId = tiers.find((r) => r.name === "pm")!.id;

    const roles = await db
      .insert(schema.role)
      .values([
        { tenantId, name: "director", description: "Test director" },
        { tenantId, name: "project_manager", description: "Test project manager" },
      ])
      .returning();
    directorRoleId = roles.find((r) => r.name === "director")!.id;
    pmRoleId = roles.find((r) => r.name === "project_manager")!.id;
  });

  afterAll(async () => {
    if (tenantId) await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
  });

  it("starts with nobody able to claim, which is the shipped default", async () => {
    /* `claim_tier_names` defaults to `[]` — "no self-claiming". A tenant seeded
       entirely that way is deadlocked, which is the whole reason this control
       exists. */
    expect(await claimTiersOf(directorRoleId)).toEqual([]);
  });

  it("writes the tier's name onto the LOGIN role of the same name", async () => {
    await admin().projectTeam.roles.setClaimable({ id: directorTierId, claimable: true });
    expect(await claimTiersOf(directorRoleId)).toEqual(["director"]);
  });

  it("reports it back on the tier register the screen reads", async () => {
    const rows = await admin().projectTeam.roles.list();
    const director = rows.find((r) => r.name === "director");
    expect(director?.claimedByRoles.map((r) => r.name)).toEqual(["director"]);
    /* And the tier that was never ticked stays empty, so the column is not
       simply reporting "some role somewhere can claim something". */
    expect(rows.find((r) => r.name === "site_marshal")?.claimedByRoles).toEqual([]);
  });

  it("is idempotent — ticking twice does not duplicate the grant", async () => {
    await admin().projectTeam.roles.setClaimable({ id: directorTierId, claimable: true });
    expect(await claimTiersOf(directorRoleId)).toEqual(["director"]);
  });

  it("removes only that tier when switched off", async () => {
    await db
      .update(schema.role)
      .set({ claimTierNames: ["director", "area_in_charge"] })
      .where(eq(schema.role.id, directorRoleId));
    await admin().projectTeam.roles.setClaimable({ id: directorTierId, claimable: false });
    /* The other grant survives: this control edits ONE entry of a list it does
       not own outright, and clobbering the whole array would silently revoke a
       grant made on the Access Roles screen. */
    expect(await claimTiersOf(directorRoleId)).toEqual(["area_in_charge"]);
  });

  it("refuses a tier with no login role, and says why", async () => {
    /* The honest failure. Inventing a login role here would make a settings
       toggle a second way to grant access. */
    await expect(
      admin().projectTeam.roles.setClaimable({ id: orphanTierId, claimable: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("needs config.manage, not merely project.team.manage", async () => {
    /* The rest of the Job Tiers screen runs on `project.team.manage`. This one
       control grants authority rather than describing a chart, so somebody who
       may edit the ladder must not thereby decide who can claim a job. */
    await expect(
      caller(["project.team.manage", "project.team.read"]).projectTeam.roles.setClaimable({
        id: directorTierId,
        claimable: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  /*
    THE TIER WHOSE NAME IS NOT ITS ROLE'S NAME.

    `pm` vs `project_manager` made Project Manager the one tier that could never
    be made claimable, on any environment — the screen answered "there is no
    access role called Project Manager", which was false: it existed under its
    spelled-out name. Resolving by label as well as by name is the fix, and
    these three tests are the reason it cannot quietly come back.
  */
  it("finds the login role by the tier's LABEL when the names differ", async () => {
    await admin().projectTeam.roles.setClaimable({ id: pmTierId, claimable: true });
    expect(await claimTiersOf(pmRoleId)).toEqual(["pm"]);
  });

  it("grants the TIER's name, not the role's, so the job picker resolves it", async () => {
    /* The subtle half. `claimOptions` joins these names against `team_role`, so
       a grant reading `project_manager` would match no tier and hand the user
       an empty take-on form — the same dead screen an unseeded tier register
       produces, reached by a different route. */
    const rows = await admin().projectTeam.roles.list();
    const pm = rows.find((r) => r.name === "pm");
    expect(pm?.claimedByRoles.map((r) => r.name)).toEqual(["project_manager"]);
  });

  it("switches off again through the same label route", async () => {
    await admin().projectTeam.roles.setClaimable({ id: pmTierId, claimable: false });
    expect(await claimTiersOf(pmRoleId)).toEqual([]);
  });

  it("cannot reach a tier in another tenant", async () => {
    const [other] = await db
      .insert(schema.tenant)
      .values({ name: "Other", slug: `other-${crypto.randomUUID()}` })
      .returning();
    const [otherTier] = await db
      .insert(schema.teamRole)
      .values({ tenantId: other!.id, name: "director", label: "Director" })
      .returning();
    await expect(
      admin().projectTeam.roles.setClaimable({ id: otherTier!.id, claimable: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.delete(schema.tenant).where(eq(schema.tenant.id, other!.id));
  });
});
