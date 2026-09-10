import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { projectTeamRouter } from "./routers/projectTeam.js";
import type { Context } from "./trpc.js";

/*
  The company's own ladder — which TIER answers to which.

  Distinct from `project-team-move.test.ts`, which covers the PERSON edge on a
  roster row. The two look alike and are deliberately different things: a
  superintendent reporting to a different PM on each of three jobs is three
  person edges and one tier edge. A test that conflated them would not notice
  if the router started writing one when asked for the other.

  What this file is really guarding is that the ladder stays INERT. It exists to
  seed the onboarding wizard and to order the progress screen, and the moment a
  permission decision reads it, the whole reason `project_team_member`'s comment
  refuses a rank in code has been reintroduced through a side door.

  Real Postgres via DATABASE_URL, throwaway tenant.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("the team-role ladder", () => {
  let db: Database;
  let tenantId: string;
  let otherTenantId: string;
  let actorUserId: string;

  const suffix = crypto.randomUUID().slice(0, 8);

  const ctx = (perms: Permission[] = ["project.team.manage", "project.team.read"]): Context => ({
    db,
    session: {
      userId: actorUserId,
      tenantId,
      employeeId: null,
      permissions: new Set<Permission>(perms),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "team-role-ladder-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  const caller = (perms?: Permission[]) => projectTeamRouter.createCaller(ctx(perms));

  async function makeTier(t: string, name: string, label: string) {
    const [row] = await db
      .insert(schema.teamRole)
      .values({ tenantId: t, name, label, canHoldCustody: false })
      .returning({ id: schema.teamRole.id });
    return row!.id;
  }

  const parentOf = async (id: string) => {
    const row = await db.query.teamRole.findFirst({ where: eq(schema.teamRole.id, id) });
    return row?.reportsToTeamRoleId ?? null;
  };

  let director: string;
  let area: string;
  let pm: string;
  let sup: string;

  beforeAll(async () => {
    db = createDb(url!);

    const [t] = await db
      .insert(schema.tenant)
      .values({ name: `Ladder ${suffix}`, slug: `ladder-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;

    const [t2] = await db
      .insert(schema.tenant)
      .values({ name: `Ladder other ${suffix}`, slug: `ladder-other-${suffix}` })
      .returning({ id: schema.tenant.id });
    otherTenantId = t2!.id;

    const [u] = await db
      .insert(schema.user)
      .values({
        tenantId,
        email: `ladder-${suffix}@stinventory.local`,
        passwordHash: "x",
        firstName: "Ladder",
        lastName: "Actor",
      })
      .returning({ id: schema.user.id });
    actorUserId = u!.id;

    director = await makeTier(tenantId, `director_${suffix}`, "Director");
    area = await makeTier(tenantId, `area_${suffix}`, "Area In-charge");
    pm = await makeTier(tenantId, `pm_${suffix}`, "Project Manager");
    sup = await makeTier(tenantId, `sup_${suffix}`, "Superintendent");
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
    await db.delete(schema.tenant).where(eq(schema.tenant.id, otherTenantId));
  });

  it("builds the chain one edge at a time", async () => {
    await caller().roles.setReportsTo({ id: area, reportsToTeamRoleId: director });
    await caller().roles.setReportsTo({ id: pm, reportsToTeamRoleId: area });
    await caller().roles.setReportsTo({ id: sup, reportsToTeamRoleId: pm });

    expect(await parentOf(area)).toBe(director);
    expect(await parentOf(pm)).toBe(area);
    expect(await parentOf(sup)).toBe(pm);
    expect(await parentOf(director)).toBeNull();
  });

  it("lets two tiers share one boss", async () => {
    /* PM and general superintendent both answer to the area in-charge. This is
       the shape a rank column cannot express, and the reason the ladder is an
       edge per row rather than an integer. */
    const gs = await makeTier(tenantId, `gs_${suffix}`, "General Superintendent");
    await caller().roles.setReportsTo({ id: gs, reportsToTeamRoleId: area });

    expect(await parentOf(gs)).toBe(area);
    expect(await parentOf(pm)).toBe(area);
  });

  it("refuses a tier reporting to itself", async () => {
    await expect(caller().roles.setReportsTo({ id: pm, reportsToTeamRoleId: pm })).rejects.toThrow(/circular/i);
    expect(await parentOf(pm)).toBe(area);
  });

  it("refuses the loop a tenant actually makes, and writes nothing", async () => {
    /* Superintendent already reports to PM. Pointing PM at superintendent on a
       later day is the edit the guard exists for. */
    await expect(caller().roles.setReportsTo({ id: pm, reportsToTeamRoleId: sup })).rejects.toThrow(/circular/i);
    expect(await parentOf(pm)).toBe(area);
    expect(await parentOf(sup)).toBe(pm);
  });

  it("refuses a loop several tiers long", async () => {
    await expect(caller().roles.setReportsTo({ id: director, reportsToTeamRoleId: sup })).rejects.toThrow(/circular/i);
    expect(await parentOf(director)).toBeNull();
  });

  it("clears an edge back to the top of the chain", async () => {
    const loose = await makeTier(tenantId, `loose_${suffix}`, "Loose");
    await caller().roles.setReportsTo({ id: loose, reportsToTeamRoleId: director });
    expect(await parentOf(loose)).toBe(director);

    await caller().roles.setReportsTo({ id: loose, reportsToTeamRoleId: null });
    expect(await parentOf(loose)).toBeNull();
  });

  it("refuses to point at another tenant's tier", async () => {
    /* The foreign key has no tenant predicate and would accept this happily.
       The WHERE clause is the isolation, so the router checks both ids against
       the caller's own register — otherwise this is a cross-tenant write
       wearing a valid reference. */
    const foreign = await makeTier(otherTenantId, `foreign_${suffix}`, "Somebody Else's Tier");
    await expect(
      caller().roles.setReportsTo({ id: pm, reportsToTeamRoleId: foreign }),
    ).rejects.toThrow(/No such team role/i);
    expect(await parentOf(pm)).toBe(area);
  });

  it("refuses to edit another tenant's tier", async () => {
    const foreign = await makeTier(otherTenantId, `foreign2_${suffix}`, "Also Theirs");
    await expect(
      caller().roles.setReportsTo({ id: foreign, reportsToTeamRoleId: null }),
    ).rejects.toThrow(/No such team role/i);
  });

  it("needs project.team.manage, not merely team read", async () => {
    await expect(
      caller(["project.team.read"]).roles.setReportsTo({ id: sup, reportsToTeamRoleId: null }),
    ).rejects.toThrow();
    expect(await parentOf(sup)).toBe(pm);
  });

  it("puts the edge on the register listing", async () => {
    const rows = await caller().roles.list();
    const row = rows.find((r) => r.id === pm);
    expect(row?.reportsToTeamRoleId).toBe(area);
  });

  it("survives its parent being deleted, and loses only the edge", async () => {
    /* ON DELETE SET NULL. A tier removed from the register must not take its
       children with it — they become top-of-chain and the tenant re-points
       them, which is recoverable. A cascade here would silently delete tiers
       that live roster rows still name. */
    const doomed = await makeTier(tenantId, `doomed_${suffix}`, "Doomed");
    const child = await makeTier(tenantId, `child_${suffix}`, "Child");
    await caller().roles.setReportsTo({ id: child, reportsToTeamRoleId: doomed });
    expect(await parentOf(child)).toBe(doomed);

    await db.delete(schema.teamRole).where(and(eq(schema.teamRole.id, doomed), eq(schema.teamRole.tenantId, tenantId)));

    const stillThere = await db.query.teamRole.findFirst({ where: eq(schema.teamRole.id, child) });
    expect(stillThere).toBeTruthy();
    expect(await parentOf(child)).toBeNull();
  });
});
