import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb } from "@optix/db";
import * as schema from "@optix/db/schema";
import { adaptBambooEmployee } from "@optix/domain";
import { applySyncPlan, buildSyncPlan, loadExisting } from "./bamboo-sync.js";

/*
  A job title decides the login role its holders get — once, and never again.

  THE GAP. The sync resolved `jobTitleName` to a `company_role` row and stopped.
  It never wrote `employee.roleId`, so every person it created arrived with no
  login role: no permissions, no custody eligibility, nothing the register could
  reason about. Somebody set 190 of them by hand, and again after every nightly
  run that added a starter. `company_role.default_role_id` (migration 0071) is
  the mapping; this file is the proof that the sync honours it in one direction
  only.

  THE RULE, and the reason these tests exist rather than a single happy path:

      FILL where there is no role. NEVER overwrite one that is there.

  An administrator's decision about one person has to outlive the next sync. A
  nightly job that quietly re-roles somebody is not a tidy-up — it is a silent
  privilege change, and it is how people stop trusting a sync. Every test below
  is some version of that one sentence.
*/
describe.skipIf(!process.env.DATABASE_URL)("BambooHR sync maps job titles to login roles", () => {
  let db: ReturnType<typeof createDb>;
  let tid: string;
  let foremanRoleId: string;
  let pmRoleId: string;

  const bamboo = (over: Record<string, unknown> = {}) => ({
    id: "7001",
    employeeId: "7001",
    firstName: "Dale",
    lastName: "Whitcomb",
    jobTitleName: "Foreman",
    status: "Active",
    ...over,
  });

  /* The real call shape: `loadExisting` builds the pre-run snapshot, which is
     what tells a fill from an overwrite. */
  const sync = async (records: Record<string, unknown>[]) => {
    const people = records.map((r) => adaptBambooEmployee(r)).flatMap((r) => (r.ok ? [r.person] : []));
    const existing = await loadExisting(db, tid);
    const plan = buildSyncPlan(people, [], existing);
    return applySyncPlan(db, tid, plan, people, existing.byId);
  };

  const personNamed = async (name: string) => {
    const [row] = await db
      .select({ id: schema.employee.id, roleId: schema.employee.roleId, companyRoleId: schema.employee.companyRoleId })
      .from(schema.employee)
      .where(and(eq(schema.employee.tenantId, tid), eq(schema.employee.name, name)));
    return row!;
  };

  const titleNamed = async (name: string) => {
    const [row] = await db
      .select({ id: schema.companyRole.id, defaultRoleId: schema.companyRole.defaultRoleId })
      .from(schema.companyRole)
      .where(and(eq(schema.companyRole.tenantId, tid), eq(schema.companyRole.name, name)));
    return row!;
  };

  const mapTitle = (companyRoleId: string, roleId: string | null) =>
    db
      .update(schema.companyRole)
      .set({ defaultRoleId: roleId })
      .where(and(eq(schema.companyRole.id, companyRoleId), eq(schema.companyRole.tenantId, tid)));

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "Bamboo roles", slug: `bamboo-roles-${crypto.randomUUID()}` })
      .returning();
    tid = t!.id;

    const [foreman] = await db
      .insert(schema.role)
      .values({ tenantId: tid, name: "foreman", description: "Holds tools on a job" })
      .returning({ id: schema.role.id });
    const [pm] = await db
      .insert(schema.role)
      .values({ tenantId: tid, name: "project_manager", description: "Runs the job" })
      .returning({ id: schema.role.id });
    foremanRoleId = foreman!.id;
    pmRoleId = pm!.id;
  });

  it("leaves a new person unroled when their title has no mapping", async () => {
    /* The honest state, and deliberately not a guess. The title has just been
       CREATED by this sync — BambooHR reported one nobody has seen before — so
       there is nothing to read. Defaulting to any role here would be guessing
       at the exact moment nobody has looked. */
    await sync([bamboo()]);

    const person = await personNamed("Dale Whitcomb");
    expect(person.roleId).toBeNull();
    /* But the title itself IS recorded, which is what makes it answerable: it
       shows up on the mapping screen with a headcount of one. */
    expect(person.companyRoleId).not.toBeNull();
  });

  it("fills the role on a later run, once the title is mapped", async () => {
    /* The ordinary case: somebody answers the question on /settings/job-titles,
       and the people already carrying that title stop being unroled without
       anybody touching them one at a time. */
    const title = await titleNamed("Foreman");
    await mapTitle(title.id, foremanRoleId);

    await sync([bamboo()]);

    expect((await personNamed("Dale Whitcomb")).roleId).toBe(foremanRoleId);
  });

  it("does NOT overwrite a role a human set, even when the title says otherwise", async () => {
    /*
      The test this file exists for.

      Dale is mapped to `foreman` by his title. An administrator decides he is
      a project manager — they know something the mapping does not. The next
      sync must leave that alone. If this ever fails, a nightly job is silently
      changing somebody's permissions.
    */
    const dale = await personNamed("Dale Whitcomb");
    await db.update(schema.employee).set({ roleId: pmRoleId }).where(eq(schema.employee.id, dale.id));

    await sync([bamboo()]);

    expect((await personNamed("Dale Whitcomb")).roleId).toBe(pmRoleId);
  });

  it("still does not overwrite when the title's mapping CHANGES", async () => {
    /* The same rule, from the other side: it is the person's existing role that
       protects them, not the mapping happening to agree. Re-pointing the title
       at a different role must not reach anybody who already has one. */
    const title = await titleNamed("Foreman");
    await mapTitle(title.id, pmRoleId);

    await sync([bamboo()]);
    expect((await personNamed("Dale Whitcomb")).roleId).toBe(pmRoleId);

    await mapTitle(title.id, foremanRoleId);
    await sync([bamboo()]);
    /* Still the human's choice, which now DISAGREES with the title again. */
    expect((await personNamed("Dale Whitcomb")).roleId).toBe(pmRoleId);
  });

  it("sets the role at creation when the title is already mapped", async () => {
    /* A starter arriving after the mapping exists never spends a moment
       unroled — which is the whole point, since the unroled window is when
       somebody has to notice and fix them by hand. */
    const title = await titleNamed("Foreman");
    await mapTitle(title.id, foremanRoleId);

    await sync([bamboo(), bamboo({ id: "7002", employeeId: "7002", firstName: "Rosa", lastName: "Ibarra" })]);

    expect((await personNamed("Rosa Ibarra")).roleId).toBe(foremanRoleId);
  });

  it("treats an absent snapshot as unknown, not as unroled", async () => {
    /*
      `applySyncPlan` takes the pre-run snapshot as a parameter, and a caller
      may pass an empty one — `bamboo-sync-contacts.test.ts` does exactly that.

      `snapshot.get(id)?.roleId == null` is true both for "has no role" and for
      "not in the snapshot". Collapsing those would make an empty map overwrite
      EVERY person's role with their title's default, which is the precise
      failure this rule exists to prevent. Absent means unknown, and unknown is
      read from the database rather than assumed.
    */
    const people = [bamboo()]
      .map((r) => adaptBambooEmployee(r))
      .flatMap((r) => (r.ok ? [r.person] : []));
    const existing = await loadExisting(db, tid);
    const plan = buildSyncPlan(people, [], existing);

    await applySyncPlan(db, tid, plan, people, new Map());

    /* Rosa's title maps to foreman and Dale's human-set role does not — an
       empty snapshot must change neither. */
    expect((await personNamed("Dale Whitcomb")).roleId).toBe(pmRoleId);
    expect((await personNamed("Rosa Ibarra")).roleId).toBe(foremanRoleId);
  });

  it("leaves everyone alone when a mapping is cleared", async () => {
    /* Clearing is "no opinion", not "remove their role". Nobody loses access
       because an administrator unmapped a title. */
    const title = await titleNamed("Foreman");
    await mapTitle(title.id, null);

    await sync([bamboo(), bamboo({ id: "7002", employeeId: "7002", firstName: "Rosa", lastName: "Ibarra" })]);

    expect((await personNamed("Dale Whitcomb")).roleId).toBe(pmRoleId);
    expect((await personNamed("Rosa Ibarra")).roleId).toBe(foremanRoleId);
  });
});
