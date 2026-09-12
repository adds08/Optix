import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { assetRouter } from "./routers/asset.js";
import type { Context } from "./trpc.js";

/*
  STI-115: asset.create must write the asset row and its opening `tag` ledger
  event atomically. The ledger is append-only (STI-104), so an asset that gets
  a projection but no opening event can never acquire one retroactively —
  STI-110's sweep reports it as no_evidence forever. These tests go through the
  real router procedure against the real Postgres, because the behaviour under
  test IS the database transaction; a mock proves nothing.

  Same harness rules as custody.test.ts / decline.test.ts: real Postgres via
  DATABASE_URL (skipped without it), a throwaway tenant, trigger-disabled
  cleanup because ledger rows are written.
*/
const url = process.env.DATABASE_URL;

/*
  A db handle whose ledger inserts fail. `insert(schema.transaction)` throws —
  both on the bare handle and inside any `transaction(fn)` callback — while
  everything else passes through to the real database. That simulates exactly
  the window this ticket exists for: the asset insert has landed, the opening
  event's insert then fails. If the two writes share a transaction, the throw
  aborts it and the asset row is rolled back; if they are bare consecutive
  awaits, the asset row survives as an orphan.
*/
function failLedgerWrites<T extends object>(handle: T): T {
  return new Proxy(handle, {
    get(target, prop) {
      if (prop === "insert") {
        return (table: unknown) => {
          if (table === schema.transaction) throw new Error("boom: ledger insert failed");
          return (target as any).insert(table);
        };
      }
      if (prop === "transaction") {
        return (fn: (tx: any) => any, ...rest: any[]) =>
          (target as any).transaction((tx: any) => fn(failLedgerWrites(tx)), ...rest);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}

describe.skipIf(!url)("asset.create writes the row and its opening event atomically (STI-115)", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;
  let locationId: string;

  const makeCtx = (dbHandle: Database): Context => ({
    db: dbHandle,
    session: {
      userId,
      tenantId,
      employeeId: null,
      permissions: new Set<Permission>(["asset.manage"]),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "sti115-test-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-115 atomic create test", slug: `sti115-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: "sti115@test.local", passwordHash: "not-a-real-hash", firstName: "STI", lastName: "OneFifteen" })
      .returning({ id: schema.user.id });
    userId = u!.id;
    const [l] = await db
      .insert(schema.location)
      .values({ tenantId, type: "warehouse", name: "STI-115 yard" })
      .returning({ id: schema.location.id });
    locationId = l!.id;
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* Ledger rows were written, so the cascade delete needs the sanctioned
         transactional trigger disable (see 0014, and the STI-113 test). */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("a failing ledger insert rolls the asset row back too — no orphan survives", async () => {
    const ctx = makeCtx(failLedgerWrites(db));
    await expect(
      assetRouter.createCaller(ctx).create({ description: "STI-115 orphan grinder" }),
    ).rejects.toThrow("boom: ledger insert failed");

    /* The whole point: query with the REAL handle. If the two writes were not
       in one transaction, the asset row committed before the ledger insert
       failed, and it is sitting here with zero ledger rows behind it. */
    const orphans = await db
      .select({ id: schema.asset.id })
      .from(schema.asset)
      .where(and(eq(schema.asset.tenantId, tenantId), eq(schema.asset.description, "STI-115 orphan grinder")));
    expect(orphans).toHaveLength(0);
  });

  it("the happy path writes both rows, and the tag event carries the complete four-key toState", async () => {
    const ctx = makeCtx(db);
    const row = await assetRouter.createCaller(ctx).create({
      description: "STI-115 demo drill",
      locationId,
    });
    expect(row).toBeDefined();

    const events = await db
      .select()
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, row!.id)));
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("tag");
    /* toEqual, not toMatchObject: the fold replaces rather than merges, so a
       missing key is not "unchanged", it is "blanked on the next rebuild".
       All four keys must be present, including the ones that are null. */
    expect(events[0]!.toState).toEqual({
      status: "available",
      custodianId: null,
      projectId: null,
      locationId,
    });
  });

  /*
    KNOWN-ISSUES 4 — a tag could be duplicated by the one path the desk uses most.

    `asset.update` has refused this since it was written and `import.commit`
    checks both the database and the file, so the single-asset create was the
    only door left open. The register is read by people who call a tool by its
    tag out loud, and two rows answering to one tag makes that conversation
    ambiguous.
  */
  it("refuses a tag already in the register", async () => {
    const ctx = makeCtx(db);
    await assetRouter.createCaller(ctx).create({ description: "first grinder", code: "DUP-001" });

    await expect(
      assetRouter.createCaller(ctx).create({ description: "second grinder", code: "DUP-001" }),
    ).rejects.toThrow(/already in the register/i);

    const rows = await db
      .select({ id: schema.asset.id })
      .from(schema.asset)
      .where(and(eq(schema.asset.tenantId, tenantId), eq(schema.asset.code, "DUP-001")));
    expect(rows).toHaveLength(1);
  });

  /*
    Untagged rows are a NORMAL state, not a collision.

    `asset.code` is nullable on purpose — the "Needs a Tag" report exists to be
    the label gun's worklist — so the guard must key on a tag being given, not
    on the column. A naive `WHERE tag = input.code` with both null would refuse
    the second untagged tool in the register.
  */
  it("still allows any number of untagged tools", async () => {
    const ctx = makeCtx(db);
    await assetRouter.createCaller(ctx).create({ description: "untagged one" });
    await assetRouter.createCaller(ctx).create({ description: "untagged two" });

    const rows = await db
      .select({ id: schema.asset.id })
      .from(schema.asset)
      .where(and(eq(schema.asset.tenantId, tenantId), isNull(schema.asset.code)));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  /*
    KNOWN-ISSUES 3 — `setStatus` declared `status: z.string()`.

    Status columns are plain `text` by design and Zod at the router edge is the
    only thing enforcing the vocabulary, so this procedure was the hole: an
    unknown value was written to the projection AND into the ledger snapshot,
    and the ledger is append-only, so it folds back out forever.
  */
  it("refuses a status that is not in the vocabulary", async () => {
    const ctx = makeCtx(db);
    const row = await assetRouter.createCaller(ctx).create({ description: "status guard drill" });

    await expect(
      /* Cast because the input type now forbids this at compile time as well —
         which is the other half of the fix, and is what caught a caller in
         tool-menu.tsx passing a widened string[]. */
      assetRouter.createCaller(ctx).setStatus({ id: row!.id, status: "banana" as never }),
    ).rejects.toThrow();

    const [after] = await db
      .select({ status: schema.asset.currentStatus })
      .from(schema.asset)
      .where(eq(schema.asset.id, row!.id));
    expect(after!.status).toBe("available");
  });

  it("still accepts a status that is in the vocabulary", async () => {
    const ctx = makeCtx(db);
    const row = await assetRouter.createCaller(ctx).create({ description: "status happy drill" });
    await assetRouter.createCaller(ctx).setStatus({ id: row!.id, status: "in_maintenance" });

    const [after] = await db
      .select({ status: schema.asset.currentStatus })
      .from(schema.asset)
      .where(eq(schema.asset.id, row!.id));
    expect(after!.status).toBe("in_maintenance");
  });

  /*
    The shop-workflow statuses (diagnosing/waiting_parts/ready_for_pickup) chain
    onto `in_maintenance` as further setStatus hops on the same tool, not a
    fresh custody event. `vehicleContextFromLedger` (custody.ts) must carry the
    truck/trailer keys the `repair` event recorded forward through every hop —
    the fold replaces rather than merges, so a hop that stayed silent on them
    would erase "still on T-1" from the fold for a tool that never left the
    truck. custodianId/projectId/locationId are restated from the asset row on
    every write already; this pins that the vehicle keys survive alongside them.
  */
  it("carries custodian/project/location/vehicle keys forward through every shop-status hop", async () => {
    const ctx = makeCtx(db);
    const [loc] = await db
      .insert(schema.location)
      .values({ tenantId, type: "vehicle", name: "STI shop-status truck" })
      .returning({ id: schema.location.id });
    const [truck] = await db
      .insert(schema.vehicle)
      .values({ tenantId, locationId: loc!.id, vehicleType: "truck", unit: "T-SHOPSTATUS" })
      .returning({ id: schema.vehicle.id });

    const row = await assetRouter.createCaller(ctx).create({ description: "shop-status drill", locationId });

    /* Simulate the `repair` action's ledger event (apply-action.ts): custody
       closes (custodianId null) but the tool is recorded as riding the shop's
       own truck (`truckId` set, not null) — the newest evidence a status-only
       hop later has to find and carry forward without being asked about it. */
    await db.insert(schema.transaction).values({
      tenantId,
      assetId: row!.id,
      eventType: "repair_start",
      toState: {
        status: "in_maintenance",
        custodianId: null,
        projectId: null,
        locationId,
        truckId: truck!.id,
        trailerId: null,
      },
      note: "STI shop-status fixture: repair",
    });
    await db
      .update(schema.asset)
      .set({ currentStatus: "in_maintenance", currentCustodianId: null, currentLocationId: loc!.id })
      .where(eq(schema.asset.id, row!.id));

    for (const status of ["diagnosing", "waiting_parts", "ready_for_pickup"] as const) {
      await assetRouter.createCaller(ctx).setStatus({ id: row!.id, status });

      const [latest] = await db
        .select({ toState: schema.transaction.toState })
        .from(schema.transaction)
        .where(and(eq(schema.transaction.assetId, row!.id), eq(schema.transaction.eventType, "status_change")))
        .orderBy(desc(schema.transaction.occurredAt), desc(schema.transaction.id))
        .limit(1);

      /* toEqual, not toMatchObject: a missing vehicle key is not "unchanged",
         it is "blanked on the next rebuild" — the same rule STI-115's create
         test pins for the four base keys, extended here to the two vehicle
         keys this writer now also carries forward. */
      expect(latest!.toState).toEqual({
        status,
        custodianId: null,
        projectId: null,
        locationId: loc!.id,
        truckId: truck!.id,
        trailerId: null,
      });
    }
  });
});
