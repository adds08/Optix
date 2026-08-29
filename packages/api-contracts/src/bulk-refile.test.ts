import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { assetRouter } from "./routers/asset.js";
import type { Context } from "./trpc.js";

/*
  STI-104 — bulk re-filing of category and department.

  Integration rather than unit, for the reason custody.test.ts gives: the
  behaviour under test IS the WHERE clause. A mocked update proves a mock
  filters; only a real Postgres proves that a selection from another tenant is
  untouched, and that is the assertion that matters most here — this is the
  only procedure in the router that writes MANY rows from a caller-supplied
  list of ids.

  Runs against the real Postgres named by DATABASE_URL — always set inside the
  api container, where `make ENV=local test` runs — and skipped without it so
  a host-side `pnpm test` still passes.
*/

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("re-filing a selection (STI-104)", () => {
  let db: Database;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let deptA: string;
  let deptB: string;
  let foreignDept: string;
  let projectId: string;

  const makeCtx = (perms: Permission[] = ["asset.manage"], tid?: string): Context => ({
    db,
    session: {
      userId,
      tenantId: tid ?? tenantId,
      employeeId: null,
      permissions: new Set<Permission>(perms),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "sti104-test-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  async function newAsset(description: string, opts: { tid?: string; category?: string | null } = {}) {
    const [row] = await db
      .insert(schema.asset)
      .values({
        tenantId: opts.tid ?? tenantId,
        description,
        currentStatus: "available",
        categoryName: opts.category ?? "Uncategorised",
      })
      .returning({ id: schema.asset.id });
    return row!.id;
  }

  const readAsset = async (id: string) =>
    (
      await db
        .select({
          categoryName: schema.asset.categoryName,
          costTarget: schema.asset.costTarget,
          owningDepartmentId: schema.asset.owningDepartmentId,
          owningProjectId: schema.asset.owningProjectId,
        })
        .from(schema.asset)
        .where(eq(schema.asset.id, id))
    )[0]!;

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-104 bulk refile", slug: `sti104-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [t2] = await db
      .insert(schema.tenant)
      .values({ name: "STI-104 other tenant", slug: `sti104b-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    otherTenantId = t2!.id;

    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: `sti104-${crypto.randomUUID().slice(0, 8)}@test.local`, passwordHash: "not-a-real-hash", firstName: "STI", lastName: "OhFour" })
      .returning({ id: schema.user.id });
    userId = u!.id;

    const [dA] = await db.insert(schema.department).values({ tenantId, name: "Rental & Maintenance", code: "RM" }).returning({ id: schema.department.id });
    deptA = dA!.id;
    const [dB] = await db.insert(schema.department).values({ tenantId, name: "Survey", code: "SV" }).returning({ id: schema.department.id });
    deptB = dB!.id;
    const [dF] = await db.insert(schema.department).values({ tenantId: otherTenantId, name: "Someone else's department" }).returning({ id: schema.department.id });
    foreignDept = dF!.id;

    const [p] = await db.insert(schema.project).values({ tenantId, name: "STI-104 job", startDate: "2025-01-06" }).returning({ id: schema.project.id });
    projectId = p!.id;
  });

  afterAll(async () => {
    if (db && tenantId) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(inArray(schema.tenant.id, [tenantId, otherTenantId]));
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("sets the category on every tool in the selection, and nothing else", async () => {
    const a = await newAsset("STI-104 grinder");
    const b = await newAsset("STI-104 saw");
    const untouched = await newAsset("STI-104 bystander");

    const res = await assetRouter.createCaller(makeCtx()).bulkUpdate({
      ids: [a, b],
      categoryName: "Power Tools",
    });

    expect(res.updated).toBe(2);
    expect((await readAsset(a)).categoryName).toBe("Power Tools");
    expect((await readAsset(b)).categoryName).toBe("Power Tools");
    /* The bystander is the point: the id list is the scope, not the filter the
       user happened to be looking at. */
    expect((await readAsset(untouched)).categoryName).toBe("Uncategorised");
  });

  it("moves costTarget WITH the department, and clears the owning job", async () => {
    const [row] = await db
      .insert(schema.asset)
      .values({
        tenantId,
        description: "STI-104 job-charged level",
        currentStatus: "available",
        costTarget: "project",
        owningProjectId: projectId,
      })
      .returning({ id: schema.asset.id });
    const id = row!.id;

    await assetRouter.createCaller(makeCtx()).bulkUpdate({ ids: [id], owningDepartmentId: deptA });

    const after = await readAsset(id);
    expect(after.owningDepartmentId).toBe(deptA);
    /* Both halves, because `assetRefine` treats them as ONE decision: a tool
       charged to a department must name one and must not also name a project.
       Writing the department alone would leave this row failing that rule the
       next time anyone opened it in the single-row editor. */
    expect(after.costTarget).toBe("department");
    expect(after.owningProjectId).toBeNull();
  });

  it("clearing the department hands the tool back to project costing", async () => {
    const id = await newAsset("STI-104 dept-charged meter");
    await assetRouter.createCaller(makeCtx()).bulkUpdate({ ids: [id], owningDepartmentId: deptB });
    expect((await readAsset(id)).costTarget).toBe("department");

    await assetRouter.createCaller(makeCtx()).bulkUpdate({ ids: [id], owningDepartmentId: null });
    const after = await readAsset(id);
    expect(after.owningDepartmentId).toBeNull();
    expect(after.costTarget).toBe("project");
  });

  it("REFUSES to touch a tool in another tenant, even when its id is passed explicitly", async () => {
    const mine = await newAsset("STI-104 mine");
    const theirs = await newAsset("STI-104 theirs", { tid: otherTenantId });

    const res = await assetRouter.createCaller(makeCtx()).bulkUpdate({
      ids: [mine, theirs],
      categoryName: "Cross-tenant probe",
    });

    /* One row updated, not two. There is no RLS here — the tenant predicate in
       the WHERE clause IS the isolation, and this is the test that proves it
       for the one procedure that takes a caller-supplied id list. */
    expect(res.updated).toBe(1);
    expect((await readAsset(mine)).categoryName).toBe("Cross-tenant probe");
    expect((await readAsset(theirs)).categoryName).toBe("Uncategorised");
  });

  it("refuses a department belonging to another tenant", async () => {
    const id = await newAsset("STI-104 foreign dept probe");
    await expect(
      assetRouter.createCaller(makeCtx()).bulkUpdate({ ids: [id], owningDepartmentId: foreignDept }),
    ).rejects.toThrow(/No such department in this tenant/);

    /* And nothing was written on the way to the refusal. */
    expect((await readAsset(id)).owningDepartmentId).toBeNull();
  });

  it("refuses a call that changes nothing, rather than silently touching every row", async () => {
    const id = await newAsset("STI-104 no-op probe");
    /* Both fields are optional in the shape, so this typechecks — the guard
       is the zod refine, and it has to be, because a client that sends only
       `ids` is exactly what a half-filled form produces. */
    await expect(
      assetRouter.createCaller(makeCtx()).bulkUpdate({ ids: [id] }),
    ).rejects.toThrow(/Nothing to change/);
  });

  it("requires asset.manage — a reader cannot re-file the register", async () => {
    const id = await newAsset("STI-104 permission probe");
    await expect(
      assetRouter.createCaller(makeCtx(["asset.read"])).bulkUpdate({ ids: [id], categoryName: "Nope" }),
    ).rejects.toThrow();
    expect((await readAsset(id)).categoryName).toBe("Uncategorised");
  });

  it("writes ONE audit entry naming the whole selection, not one per tool", async () => {
    const a = await newAsset("STI-104 audit a");
    const b = await newAsset("STI-104 audit b");
    const c = await newAsset("STI-104 audit c");

    await assetRouter.createCaller(makeCtx()).bulkUpdate({ ids: [a, b, c], categoryName: "Audited" });

    const entries = await db
      .select({ action: schema.eventLog.action, entityLabel: schema.eventLog.entityLabel, details: schema.eventLog.details })
      .from(schema.eventLog)
      .where(and(eq(schema.eventLog.tenantId, tenantId), eq(schema.eventLog.action, "bulk_update")));

    /* Scoped to THIS call's ids — every other test in this file re-files
       something too, so a bare count would assert the order tests run in
       rather than the behaviour. */
    const mine = entries.filter((e) => {
      const ids = (e.details as { ids?: string[] } | null)?.ids ?? [];
      return ids.includes(a);
    });

    expect(mine).toHaveLength(1);
    expect(mine[0]!.entityLabel).toBe("3 tools");
    expect((mine[0]!.details as { ids: string[] }).ids.sort()).toEqual([a, b, c].sort());
  });

  it("writes NO ledger event — re-filing is book-keeping, not custody", async () => {
    const id = await newAsset("STI-104 ledger probe");
    await assetRouter.createCaller(makeCtx()).bulkUpdate({ ids: [id], categoryName: "Still not custody" });

    const events = await db
      .select({ id: schema.transaction.id })
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, id)));

    /* Nothing here touches custodian, project, location or status, so there is
       no `toState` to write. A ledger event with a snapshot that restates the
       current one is noise in an append-only log — and a PARTIAL one would
       blank the tool on the next rebuild. */
    expect(events).toHaveLength(0);
  });
});
