import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import { foldAssetState, reconcileProjections, type EventEnvelope } from "@stinventory/domain";
import type { Permission } from "@stinventory/types";
import { closeActiveCustody, moveCustody } from "./custody.js";
import { assignmentRouter } from "./routers/assignment.js";
import { transferRouter } from "./routers/transfer.js";
import { locationRouter, vehicleRouter } from "./routers/location.js";
import type { Context } from "./trpc.js";

/*
  Integration tests, not unit tests: the behaviour STI-102 exists for IS the
  database's locking, so a mock proves nothing. They run against the real
  Postgres named by DATABASE_URL — always set inside the api container, where
  `make ENV=local test` runs — and are skipped without it so a host-side
  `pnpm test` still passes. Everything lives under a throwaway tenant that is
  deleted (cascading) afterwards, so a shared dev database stays clean; no
  ledger rows are written because custody.ts deliberately does not write them.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("custody writes are transactional and row-locked (STI-102)", () => {
  let db: Database;
  let tenantId: string;
  let empA: string;
  let empB: string;

  const activeLinks = (assetId: string) =>
    db
      .select({ id: schema.assignment.id, custodianId: schema.assignment.custodianId })
      .from(schema.assignment)
      .where(
        and(
          eq(schema.assignment.tenantId, tenantId),
          eq(schema.assignment.assetId, assetId),
          eq(schema.assignment.status, "active"),
        ),
      );

  async function newAsset(): Promise<string> {
    const [row] = await db
      .insert(schema.asset)
      .values({ tenantId, description: "STI-102 impact driver" })
      .returning({ id: schema.asset.id });
    return row!.id;
  }

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-102 concurrency test", slug: `sti102-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [a] = await db.insert(schema.employee).values({ tenantId, name: "Foreman A" }).returning({ id: schema.employee.id });
    const [b] = await db.insert(schema.employee).values({ tenantId, name: "Foreman B" }).returning({ id: schema.employee.id });
    empA = a!.id;
    empB = b!.id;
  });

  afterAll(async () => {
    if (db && tenantId) {
      // Every table in play cascades from tenant.
      await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
    }
    await db?.$client.end();
  });

  it("two simultaneous moves on one asset leave exactly one active assignment", async () => {
    /* The bug this ticket exists for: without the asset-row FOR UPDATE lock,
       both writers read "nothing active", neither closes anything, and the
       tool ends up in two people's custody. Raced several times because an
       interleaving bug that only fails sometimes is still a bug. */
    for (let i = 0; i < 5; i++) {
      const assetId = await newAsset();
      await Promise.all([
        db.transaction((tx) =>
          moveCustody(tx, { tenantId, assetId, toCustodianId: empA, projectId: null, locationId: null, actorUserId: null }),
        ),
        db.transaction((tx) =>
          moveCustody(tx, { tenantId, assetId, toCustodianId: empB, projectId: null, locationId: null, actorUserId: null }),
        ),
      ]);

      const active = await activeLinks(assetId);
      expect(active).toHaveLength(1);

      /* Both moves really happened — one opened and was closed by the other,
         serialised — rather than one being swallowed. */
      const all = await db
        .select({ id: schema.assignment.id })
        .from(schema.assignment)
        .where(and(eq(schema.assignment.tenantId, tenantId), eq(schema.assignment.assetId, assetId)));
      expect(all).toHaveLength(2);
    }
  });

  it("a failure after the custody write rolls the whole move back", async () => {
    const assetId = await newAsset();
    await db.transaction((tx) =>
      moveCustody(tx, { tenantId, assetId, toCustodianId: empA, projectId: null, locationId: null, actorUserId: null }),
    );

    /* Simulates the caller's projection or ledger write failing AFTER the
       close+open — the half-applied state that used to persist when these
       were bare consecutive writes. */
    await expect(
      db.transaction(async (tx) => {
        await moveCustody(tx, { tenantId, assetId, toCustodianId: empB, projectId: null, locationId: null, actorUserId: null });
        throw new Error("boom: projection write failed");
      }),
    ).rejects.toThrow("boom");

    const active = await activeLinks(assetId);
    expect(active).toHaveLength(1);
    expect(active[0]!.custodianId).toBe(empA);
  });

  it("closes every active duplicate, not just the first found", async () => {
    /* Close-by-predicate is deliberate (see custody.ts): rows written before
       the STI-103 unique index existed may carry duplicate actives, and closing
       only the first would strand the rest active forever. Pinned here so a
       by-id "optimisation" fails loudly.

       Since STI-103 the database itself forbids the state this test needs —
       two active rows for one asset trips `assignment_one_active_uq` at insert.
       That does NOT make this test obsolete: the index only blocks NEW
       duplicates, while closeActiveCustody must still clean up pre-index ones
       (production data predating the constraint has not been verified clean).
       A partial unique INDEX cannot be made DEFERRABLE — only unique
       constraints can be deferred, and a constraint cannot carry a WHERE — so
       the fabrication drops the index inside this transaction and recreates
       it before commit. DDL is transactional in Postgres, so an abort restores
       the index; recreating from pg_indexes' own indexdef keeps the test from
       drifting out of sync with the migrated definition. */
    const assetId = await newAsset();
    const dup = {
      tenantId,
      assetId,
      custodianId: empA,
      startDate: new Date().toISOString().slice(0, 10),
      status: "active",
    };

    const closed = await db.transaction(async (tx) => {
      const [idx] = await tx.execute(sql`select indexdef from pg_indexes where indexname = 'assignment_one_active_uq'`);
      /* If the index has vanished, fail here rather than silently testing less. */
      expect(idx?.indexdef).toBeTruthy();
      await tx.execute(sql`drop index "assignment_one_active_uq"`);
      // Bypasses custody.ts on purpose to fabricate the corrupt pre-index state.
      await tx.insert(schema.assignment).values([dup, { ...dup, custodianId: empB }]);
      const ids = await closeActiveCustody(tx, tenantId, assetId);
      await tx.execute(sql.raw(String(idx!.indexdef)));
      return ids;
    });
    expect(closed).toHaveLength(2);
    expect(await activeLinks(assetId)).toHaveLength(0);
  });

  it("the database refuses a second active assignment for one asset (STI-103)", async () => {
    const assetId = await newAsset();
    await db.transaction((tx) =>
      moveCustody(tx, { tenantId, assetId, toCustodianId: empA, projectId: null, locationId: null, actorUserId: null }),
    );

    /* Bypasses custody.ts the way every historical duplicate did — the point
       of STI-103 is that the bypass now dies at the database instead of
       quietly shipping two custodians. */
    await expect(
      db.insert(schema.assignment).values({
        tenantId,
        assetId,
        custodianId: empB,
        startDate: new Date().toISOString().slice(0, 10),
        status: "active",
      }),
    ).rejects.toThrow(/assignment_one_active_uq/);

    /* The index is partial: a closed row does not count against it, so a
       returned tool can be reissued. */
    await db.transaction((tx) =>
      moveCustody(tx, { tenantId, assetId, toCustodianId: empB, projectId: null, locationId: null, actorUserId: null }),
    );
    expect(await activeLinks(assetId)).toHaveLength(1);
    expect((await activeLinks(assetId))[0]!.custodianId).toBe(empB);
  });

  it("refuses a raw db handle at compile time", () => {
    /* Criterion 1 of the ticket: a raw `db` where a tx is required is a TYPE
       error, not a convention — `db: any` is how a raw handle got passed in
       the first place. If this assignment ever compiles, the guarantee is gone
       and `tsc` fails the build on the unused expectation below. */
    const wouldNotCompile = () =>
      // @ts-expect-error — Database is not assignable to Transaction; custody writes must run inside db.transaction()
      closeActiveCustody(db, tenantId, "not-run", "transferred");
    expect(typeof wouldNotCompile).toBe("function");
  });
});

/*
  STI-113: `assignment.return` wrote the projection and the ledger from two
  different ideas of what a return means — the asset row kept its project and
  location while the ledger event nulled both. The fold replaces rather than
  merges, so from the first real return the register and the ledger disagreed,
  every 6-hour sweep raised a custody_discrepancy, and a rebuild made the
  blanking permanent.

  This exercises the REAL procedure through a router caller against the real
  database — not a reimplementation of its writes — so it goes red if either
  side of the write drifts from the other again.
*/
describe.skipIf(!url)("assignment.return keeps the ledger and the projection in agreement (STI-113)", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;
  let empId: string;
  let projectId: string;
  let locationId: string;
  let assetId: string;
  let assignmentId: string;

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-113 return test", slug: `sti113-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: "sti113@test.local", passwordHash: "not-a-real-hash", firstName: "STI", lastName: "OneThirteen" })
      .returning({ id: schema.user.id });
    userId = u!.id;
    const [emp] = await db.insert(schema.employee).values({ tenantId, name: "Foreman C" }).returning({ id: schema.employee.id });
    empId = emp!.id;
    const [p] = await db.insert(schema.project).values({ tenantId, name: "STI-113 substation", startDate: "2025-01-06" }).returning({ id: schema.project.id });
    projectId = p!.id;
    const [l] = await db
      .insert(schema.location)
      .values({ tenantId, type: "warehouse", name: "STI-113 yard" })
      .returning({ id: schema.location.id });
    locationId = l!.id;
    const [a] = await db
      .insert(schema.asset)
      .values({ tenantId, description: "STI-113 demo saw" })
      .returning({ id: schema.asset.id });
    assetId = a!.id;

    /* An assigned tool with a project and a location — the state every real
       return starts from, and exactly the state the bug blanked. Custody opens
       through the chokepoint; the projection and the assign ledger event mirror
       what assignment.create writes. */
    const { openedId } = await db.transaction((tx) =>
      moveCustody(tx, { tenantId, assetId, toCustodianId: empId, projectId, locationId, actorUserId: userId }),
    );
    assignmentId = openedId!;
    await db
      .update(schema.asset)
      .set({ currentStatus: "assigned", currentCustodianId: empId, currentProjectId: projectId, currentLocationId: locationId })
      .where(eq(schema.asset.id, assetId));
    await db.insert(schema.transaction).values({
      tenantId,
      assetId,
      eventType: "assign",
      actorId: userId,
      toState: { status: "assigned", custodianId: empId, projectId, locationId },
      refType: "assignment",
      refId: assignmentId,
      note: "STI-113 baseline assign",
    });
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* This tenant owns ledger rows, so a bare cascade delete would be blocked
         by the 0014 append-only triggers. Same sanctioned transactional
         disable/enable the STI-104 test and the seed's wipe use. */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("after a return, replaying the ledger reproduces the projection exactly", async () => {
    const ctx: Context = {
      db,
      session: {
        userId,
        tenantId,
        employeeId: null,
        permissions: new Set<Permission>(["assignment.create"]),
        roleName: null,
        actorLabel: null,
      },
      sessionSecret: "sti113-test-secret",
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    };
    const caller = assignmentRouter.createCaller(ctx);
    await caller.return({ id: assignmentId });

    const asset = await db.query.asset.findFirst({ where: and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tenantId)) });
    expect(asset).toBeDefined();

    /* The register's answer: nobody holds it, it is booked to no job, and it
       still sits wherever it was last recorded. Tools follow the person — the
       project comes from the custodian (projectForCustodian), so no custodian
       means no project. Location is a physical fact independent of custody and
       this procedure takes no location input, so the last known one stands —
       the same semantics the chat return in apply-action.ts already has. */
    expect(asset!.currentStatus).toBe("available");
    expect(asset!.currentCustodianId).toBeNull();
    expect(asset!.currentProjectId).toBeNull();
    expect(asset!.currentLocationId).toBe(locationId);

    /* The heart of the ticket: the ledger must say the same thing. The fold
       replaces rather than merges, so any key on which the return event and
       the projection disagree is a divergence — the sweep would alert on it
       and a rebuild would overwrite the register with it. */
    const events = (await db
      .select()
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)))) as unknown as EventEnvelope[];
    const divergences = reconcileProjections(
      [
        {
          assetId,
          label: null,
          status: asset!.currentStatus,
          custodianId: asset!.currentCustodianId,
          projectId: asset!.currentProjectId,
          locationId: asset!.currentLocationId,
        },
      ],
      events,
    );
    expect(divergences).toEqual([]);

    /* And the return event itself carries the complete snapshot — since
       STI-203 that includes the vehicle keys as EXPLICIT nulls: a return
       means the tool came back in, out of whoever's rig. */
    const returnEvent = events.filter((e) => e.eventType === "return").at(-1);
    expect(returnEvent?.toState).toEqual({
      status: "available",
      custodianId: null,
      projectId: null,
      locationId,
      truckId: null,
      trailerId: null,
    });

    /* The link itself closed. */
    const link = await db.query.assignment.findFirst({ where: eq(schema.assignment.id, assignmentId) });
    expect(link?.status).toBe("returned");
  });
});

/*
  STI-203: truck and trailer ride through custody.

  Three things are pinned here, because nothing else will catch them:

  - moveCustody persists the vehicle context on the link it opens, and an
    omitted key still writes an affirmative NULL on the row.
  - assertVehicleContext is the only guard in front of a composite FK that is
    TENANT-BLIND: `vehicle_id_type_uq` is (id, vehicle_type) with no tenant
    component, so the database would happily let tenant A's assignment
    reference tenant B's truck. Only one tenant is seeded, so no seeded-data
    test can ever trip this — it has to be fabricated, which is what the
    second-tenant fixture below is for.
  - The custody writers' ledger events carry BOTH keys explicitly, and the
    from=to decline writers carry the previous snapshot's keys forward
    verbatim instead of stamping blind nulls over a recorded ride.
*/
describe.skipIf(!url)("truck and trailer ride through custody (STI-203)", () => {
  let db: Database;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let empA: string;
  let empB: string;
  let truckId: string;
  let trailerId: string;
  let foreignTruckId: string;
  let ctx: Context;

  async function newAsset(): Promise<string> {
    const [row] = await db
      .insert(schema.asset)
      .values({ tenantId, description: "STI-203 rotary hammer" })
      .returning({ id: schema.asset.id });
    return row!.id;
  }

  /* A vehicle is 1:1 with a vehicle-type location row; both are needed. */
  async function newVehicle(tid: string, vehicleType: "truck" | "trailer", unit: string): Promise<string> {
    const [loc] = await db
      .insert(schema.location)
      .values({ tenantId: tid, type: "vehicle", name: unit })
      .returning({ id: schema.location.id });
    const [v] = await db
      .insert(schema.vehicle)
      .values({ tenantId: tid, locationId: loc!.id, vehicleType, unit })
      .returning({ id: schema.vehicle.id });
    return v!.id;
  }

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-203 ride test", slug: `sti203-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [t2] = await db
      .insert(schema.tenant)
      .values({ name: "STI-203 other tenant", slug: `sti203b-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    otherTenantId = t2!.id;
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: "sti203@test.local", passwordHash: "not-a-real-hash", firstName: "STI", lastName: "TwoOhThree" })
      .returning({ id: schema.user.id });
    userId = u!.id;
    const [a] = await db.insert(schema.employee).values({ tenantId, name: "Foreman A" }).returning({ id: schema.employee.id });
    empA = a!.id;
    const [b] = await db.insert(schema.employee).values({ tenantId, name: "Foreman B" }).returning({ id: schema.employee.id });
    empB = b!.id;
    truckId = await newVehicle(tenantId, "truck", "T-203");
    trailerId = await newVehicle(tenantId, "trailer", "TR-203");
    foreignTruckId = await newVehicle(otherTenantId, "truck", "T-FOREIGN");

    ctx = {
      db,
      session: {
        userId,
        tenantId,
        employeeId: null,
        permissions: new Set<Permission>(["assignment.create", "assignment.approve", "transfer.create", "transfer.approve", "location.manage", "vehicle.manage"]),
        roleName: null,
        actorLabel: null,
      },
      sessionSecret: "sti203-test-secret",
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    };
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* Ledger rows are written by the router tests below, so the cascade
         delete needs the sanctioned transactional trigger disable (0014). */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, otherTenantId));
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("moveCustody persists the rig on the opened link, and omitted keys write NULL", async () => {
    const assetId = await newAsset();
    const { openedId } = await db.transaction((tx) =>
      moveCustody(tx, { tenantId, assetId, toCustodianId: empA, projectId: null, locationId: null, truckId, trailerId, actorUserId: userId }),
    );
    const row = await db.query.assignment.findFirst({ where: eq(schema.assignment.id, openedId!) });
    expect(row?.truckId).toBe(truckId);
    expect(row?.trailerId).toBe(trailerId);

    /* A move that never mentions vehicles still writes an affirmative NULL on
       the row — the three-state distinction lives in the ledger, not here. */
    const { openedId: opened2 } = await db.transaction((tx) =>
      moveCustody(tx, { tenantId, assetId, toCustodianId: empA, projectId: null, locationId: null, actorUserId: userId }),
    );
    const row2 = await db.query.assignment.findFirst({ where: eq(schema.assignment.id, opened2!) });
    expect(row2?.truckId).toBeNull();
    expect(row2?.trailerId).toBeNull();
  });

  it("a trailer in the truck slot is refused with a readable error, and the move rolls back whole", async () => {
    const assetId = await newAsset();
    await db.transaction((tx) =>
      moveCustody(tx, { tenantId, assetId, toCustodianId: empA, projectId: null, locationId: null, truckId, trailerId: null, actorUserId: userId }),
    );

    /* The composite FK would answer this with a raw 23503; the chokepoint has
       to answer it with a sentence a person can act on. */
    await expect(
      db.transaction((tx) =>
        moveCustody(tx, { tenantId, assetId, toCustodianId: empA, projectId: null, locationId: null, truckId: trailerId, actorUserId: userId }),
      ),
    ).rejects.toThrow("TR-203 is a trailer, not a truck");

    /* closeActiveCustody ran before the check inside the same tx — the
       rollback must restore the previous link, not leave the tool unheld. */
    const active = await db
      .select({ truckId: schema.assignment.truckId })
      .from(schema.assignment)
      .where(and(eq(schema.assignment.tenantId, tenantId), eq(schema.assignment.assetId, assetId), eq(schema.assignment.status, "active")));
    expect(active).toHaveLength(1);
    expect(active[0]!.truckId).toBe(truckId);
  });

  it("another tenant's truck is invisible, though the tenant-blind FK would accept it", async () => {
    const assetId = await newAsset();
    /* This is the case neither the database nor seeded data can catch: the
       composite FK carries no tenant component, so without the WHERE clause
       in assertVehicleContext this write would SUCCEED. */
    await expect(
      db.transaction((tx) =>
        moveCustody(tx, { tenantId, assetId, toCustodianId: empA, projectId: null, locationId: null, truckId: foreignTruckId, actorUserId: userId }),
      ),
    ).rejects.toThrow("No such truck in this tenant");
  });

  it("assignment.create writes the rig to the row AND a six-key toState to the ledger", async () => {
    const assetId = await newAsset();
    const caller = assignmentRouter.createCaller(ctx);
    const res = await caller.create({ assetId, custodianId: empA, truckId, trailerId });
    expect(res.needsApproval).toBe(false);

    const link = await db.query.assignment.findFirst({ where: eq(schema.assignment.id, res.assignment!.id) });
    expect(link?.truckId).toBe(truckId);
    expect(link?.trailerId).toBe(trailerId);

    /* Criterion 2, the one that has shipped broken three times: the snapshot
       must carry BOTH vehicle keys explicitly — an absent key folds to "never
       asked", which is only truthful of pre-STI-202 writers. */
    const [event] = await db
      .select({ toState: schema.transaction.toState })
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)));
    expect(event!.toState).toMatchObject({ status: "assigned", custodianId: empA, truckId, trailerId });
    expect(Object.keys(event!.toState as object).sort()).toEqual(
      ["custodianId", "locationId", "projectId", "status", "trailerId", "truckId"],
    );
  });

  it("assignment.create refuses a truck in the trailer slot before writing anything", async () => {
    const assetId = await newAsset();
    const caller = assignmentRouter.createCaller(ctx);
    await expect(caller.create({ assetId, custodianId: empA, trailerId: truckId })).rejects.toThrow(
      "T-203 is a truck, not a trailer",
    );
    const events = await db
      .select({ id: schema.transaction.id })
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)));
    expect(events).toHaveLength(0);
  });

  it("a decline carries the recorded ride forward verbatim instead of nulling it (STI-203)", async () => {
    const assetId = await newAsset();
    const caller = assignmentRouter.createCaller(ctx);
    const res = await caller.create({ assetId, custodianId: empA, truckId });
    /* Keep the projection in step with what create wrote, the way the real
       procedure does, so decline's four base keys match the ledger. */
    const [pending] = await db
      .insert(schema.assignment)
      .values({ tenantId, assetId, custodianId: empA, startDate: new Date().toISOString().slice(0, 10), status: "pending_approval" })
      .returning({ id: schema.assignment.id });

    await caller.decline({ id: pending!.id, reason: "STI-203 carry-forward" });

    const [event] = await db
      .select({ toState: schema.transaction.toState })
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.refType, "assignment"), eq(schema.transaction.refId, pending!.id)));
    /* The assign event said truckId = T-203, trailerId = null. "Nothing
       changed" must re-say exactly that — a blind null here would blank the
       ride on the next rebuild, and inventing a value would be worse. */
    expect(event!.toState).toMatchObject({ truckId, trailerId: null });
    expect(res.assignment).toBeTruthy();
  });

  it("a held transfer parks the rig on the row, and approve applies it (0017)", async () => {
    /* The gap 0017 exists for: a high-value transfer writes ONLY a transfer
       row, so before to_truck_id/to_trailer_id the requester's pick vanished
       and approve could only write nulls — "affirmatively no truck", a lie
       about what was asked. The threshold makes this asset park. */
    await db.insert(schema.tenantSettings).values({ tenantId, highValueThreshold: 5000 });
    const [big] = await db
      .insert(schema.asset)
      .values({ tenantId, description: "STI-203 big generator", acquisitionCost: "9000.00" })
      .returning({ id: schema.asset.id });
    const caller = transferRouter.createCaller(ctx);

    const res = await caller.create({
      assetId: big!.id,
      toCustodianId: empA,
      toTruckId: truckId,
      toTrailerId: trailerId,
      reason: "reallocation",
    });
    expect(res.outcome).toBe("approve");

    /* Parked, not applied: the pick is on the row, custody has not moved. */
    const parked = await db.query.transfer.findFirst({ where: eq(schema.transfer.id, res.transfer!.id) });
    expect(parked?.status).toBe("pending_approval");
    expect(parked?.toTruckId).toBe(truckId);
    expect(parked?.toTrailerId).toBe(trailerId);
    const before = await db
      .select({ id: schema.assignment.id })
      .from(schema.assignment)
      .where(and(eq(schema.assignment.tenantId, tenantId), eq(schema.assignment.assetId, big!.id)));
    expect(before).toHaveLength(0);

    await caller.approve({ id: res.transfer!.id });

    /* The link the approve opened carries the parked rig… */
    const [link] = await db
      .select({ truckId: schema.assignment.truckId, trailerId: schema.assignment.trailerId })
      .from(schema.assignment)
      .where(
        and(eq(schema.assignment.tenantId, tenantId), eq(schema.assignment.assetId, big!.id), eq(schema.assignment.status, "active")),
      );
    expect(link).toEqual({ truckId, trailerId });

    /* …and so does the ledger event, all six keys explicit. */
    const [event] = await db
      .select({ toState: schema.transaction.toState })
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.refType, "transfer"), eq(schema.transaction.refId, res.transfer!.id)));
    expect(event!.toState).toMatchObject({ status: "assigned", custodianId: empA, truckId, trailerId });
    expect(Object.keys(event!.toState as object).sort()).toEqual(
      ["custodianId", "locationId", "projectId", "status", "trailerId", "truckId"],
    );
  });

  it("a container hand-over carries the recorded ride forward instead of erasing it", async () => {
    /* The sequence that silently lost the rig: (1) tool assigned into TE-006,
       six-key snapshot; (2) the trailer handed to another foreman —
       applyContainerCustody used to write a FOUR-key custodian_change;
       (3) the fold (replace, not merge) now answered "trailer unknown" for a
       tool that never left the trailer. No divergence fires, because the
       register has no vehicle columns — it fails silently, which is what
       makes this bug class expensive. The writer carries the newest
       snapshot's vehicle keys forward verbatim instead. */
    const assetId = await newAsset();
    const trailerLoc = (await db.query.vehicle.findFirst({ where: eq(schema.vehicle.id, trailerId) }))!.locationId;

    /* Assigned INTO the trailer, with the trailer's own location row too.
       Since STI-207 the location is no longer what makes it aboard — the
       assignment's `trailerId` is — but keeping both set here holds this test
       to its original subject: that the hand-over CARRIES the ride forward.
       The next test covers the case where only the assignment says so. */
    await assignmentRouter.createCaller(ctx).create({ assetId, custodianId: empA, trailerId, locationId: trailerLoc });

    await locationRouter.createCaller(ctx).setCustodian({
      locationId: trailerLoc,
      custodianEmployeeId: empB,
      moveContents: true,
    });

    const events = (await db
      .select()
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)))) as unknown as EventEnvelope[];
    const folded = foldAssetState(events);
    expect(folded.custodianId).toBe(empB);
    /* The heart of it: the hand-over changed WHO, not where-it-rides. */
    expect(folded.trailerId).toBe(trailerId);
    expect(folded.truckId).toBeNull(); // create wrote an explicit null; carried forward as-is

    /* And the link the move opened tells the same story as the event. */
    const [link] = await db
      .select({ custodianId: schema.assignment.custodianId, truckId: schema.assignment.truckId, trailerId: schema.assignment.trailerId })
      .from(schema.assignment)
      .where(and(eq(schema.assignment.tenantId, tenantId), eq(schema.assignment.assetId, assetId), eq(schema.assignment.status, "active")));
    expect(link).toEqual({ custodianId: empB, truckId: null, trailerId });
  });

  it("a tool aboard by its ASSIGNMENT but parked elsewhere by location still moves with its trailer", async () => {
    /*
      STI-207 — the case that silently failed before the containment rule
      changed, and the reason it was invisible.

      `applyContainerCustody` used to decide who was aboard by
      `asset.current_location_id`. Every seeded row put the tool's location AT
      its trailer's location row, so both signals agreed and it did not matter
      which one the query read. The shape STI-202's schema comment actually
      prescribes is this one: the vehicle in `trailerId`, and `locationId`
      carrying a NON-vehicle place — here a yard.

      Under the old query this tool was aboard TE-006 by the assignment and NOT
      aboard by the location, so handing the trailer over left its custody
      behind. It then read "Rides in: TR-203" while still held by Foreman A:
      no error, no divergence — the projection and the ledger agreeing with
      each other and both wrong about the world.
    */
    const assetId = await newAsset();
    const trailerLoc = (await db.query.vehicle.findFirst({ where: eq(schema.vehicle.id, trailerId) }))!.locationId;

    /* A yard: a real place that is NOT a vehicle. */
    const [yard] = await db
      .insert(schema.location)
      .values({ tenantId, type: "warehouse", name: "STI-207 Yard" })
      .returning({ id: schema.location.id });

    await assignmentRouter
      .createCaller(ctx)
      .create({ assetId, custodianId: empA, trailerId, locationId: yard!.id });

    /* Precondition — the two signals genuinely disagree, which is what makes
       this test meaningful rather than a restatement of the one above. */
    const [before] = await db
      .select({ locationId: schema.asset.currentLocationId, custodianId: schema.asset.currentCustodianId })
      .from(schema.asset)
      .where(eq(schema.asset.id, assetId));
    expect(before!.locationId).toBe(yard!.id);
    expect(before!.locationId).not.toBe(trailerLoc);
    expect(before!.custodianId).toBe(empA);

    await locationRouter.createCaller(ctx).setCustodian({
      locationId: trailerLoc,
      custodianEmployeeId: empB,
      moveContents: true,
    });

    /* It moved — this is the assertion that fails on the old query. */
    const [after] = await db
      .select({ custodianId: schema.asset.currentCustodianId })
      .from(schema.asset)
      .where(eq(schema.asset.id, assetId));
    expect(after!.custodianId).toBe(empB);

    /* …and it carried its rig, so STI-203's carry-forward still holds on the
       path STI-207 rerouted. */
    const events = (await db
      .select()
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)))) as unknown as EventEnvelope[];
    const folded = foldAssetState(events);
    expect(folded.custodianId).toBe(empB);
    expect(folded.trailerId).toBe(trailerId);
    expect(folded.truckId).toBeNull();

    const [link] = await db
      .select({ custodianId: schema.assignment.custodianId, trailerId: schema.assignment.trailerId })
      .from(schema.assignment)
      .where(and(eq(schema.assignment.tenantId, tenantId), eq(schema.assignment.assetId, assetId), eq(schema.assignment.status, "active")));
    expect(link).toEqual({ custodianId: empB, trailerId });
  });

  it("a container hand-over does NOT relocate the tool, and leaves no projection divergence", async () => {
    /*
      Caught in adversarial review before it shipped, and it is the sharper
      half of STI-207.

      The old contents query WAS `currentLocationId = locationId`, so writing
      the container's location into the link and the snapshot merely restated
      something already true. Selecting by assignment removed that identity: a
      tool recorded in a yard would have had the trailer's location row stamped
      onto its ledger event while `applyContainerCustody` — which deliberately
      never writes `currentLocationId` — left the projection in the yard. The
      fold would then disagree with the register: a `stale_projection`
      divergence re-raised every six hours forever, and an `asset.rebuild` that
      silently relocates the tool out of the yard.

      A hand-over changes WHO holds the tool, not where it is.
    */
    const assetId = await newAsset();
    const trailerLoc = (await db.query.vehicle.findFirst({ where: eq(schema.vehicle.id, trailerId) }))!.locationId;
    const [yard] = await db
      .insert(schema.location)
      .values({ tenantId, type: "warehouse", name: "STI-207 Divergence Yard" })
      .returning({ id: schema.location.id });

    await assignmentRouter
      .createCaller(ctx)
      .create({ assetId, custodianId: empA, trailerId, locationId: yard!.id });

    await locationRouter.createCaller(ctx).setCustodian({
      locationId: trailerLoc,
      custodianEmployeeId: empB,
      moveContents: true,
    });

    /* The projection did not move the tool out of the yard… */
    const [projection] = await db
      .select({ locationId: schema.asset.currentLocationId, custodianId: schema.asset.currentCustodianId })
      .from(schema.asset)
      .where(eq(schema.asset.id, assetId));
    expect(projection!.custodianId).toBe(empB);
    expect(projection!.locationId).toBe(yard!.id);

    /* …and neither did the ledger, so the two still agree. This is the
       assertion that fails if the container's location is written here. */
    const events = (await db
      .select()
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)))) as unknown as EventEnvelope[];
    const folded = foldAssetState(events);
    expect(folded.locationId).toBe(yard!.id);
    expect(folded.custodianId).toBe(empB);
    expect(folded.trailerId).toBe(trailerId);

    /* The link the move opened tells the same story — STI-113's lesson. */
    const [link] = await db
      .select({ locationId: schema.assignment.locationId, trailerId: schema.assignment.trailerId })
      .from(schema.assignment)
      .where(and(eq(schema.assignment.tenantId, tenantId), eq(schema.assignment.assetId, assetId), eq(schema.assignment.status, "active")));
    expect(link).toEqual({ locationId: yard!.id, trailerId });
  });

  it("handing a trailer BACK and then out again still moves the tools aboard it", async () => {
    /*
      Also from review. Selecting purely by active assignment is a trapdoor on
      the return leg: `moveCustody` with a null custodian CLOSES the active
      link and opens nothing, so after a hand-back no assignment names the
      trailer at all. A second hand-over would then find zero tools while they
      sat in the trailer — permanently orphaned, no error, no divergence.

      Hence the precedence rule: an UNHELD tool (no active assignment) is
      aboard by its location row, which for such a tool is the only record
      there is.
    */
    const assetId = await newAsset();
    const trailerLoc = (await db.query.vehicle.findFirst({ where: eq(schema.vehicle.id, trailerId) }))!.locationId;

    await assignmentRouter
      .createCaller(ctx)
      .create({ assetId, custodianId: empA, trailerId, locationId: trailerLoc });

    const caller = locationRouter.createCaller(ctx);

    /* Hand it back: custody closes, nothing reopens. */
    await caller.setCustodian({ locationId: trailerLoc, custodianEmployeeId: null, moveContents: true });
    const [unheld] = await db
      .select({ custodianId: schema.asset.currentCustodianId, status: schema.asset.currentStatus })
      .from(schema.asset)
      .where(eq(schema.asset.id, assetId));
    expect(unheld!.custodianId).toBeNull();
    expect(unheld!.status).toBe("available");
    const active = await db
      .select({ id: schema.assignment.id })
      .from(schema.assignment)
      .where(and(eq(schema.assignment.tenantId, tenantId), eq(schema.assignment.assetId, assetId), eq(schema.assignment.status, "active")));
    expect(active).toHaveLength(0); // nothing names the trailer any more

    /* Hand it out again — this is the assertion that fails without the
       unheld-by-location leg. */
    await caller.setCustodian({ locationId: trailerLoc, custodianEmployeeId: empB, moveContents: true });
    const [reheld] = await db
      .select({ custodianId: schema.asset.currentCustodianId })
      .from(schema.asset)
      .where(eq(schema.asset.id, assetId));
    expect(reheld!.custodianId).toBe(empB);
  });

  it("a TRUCK as the container moves the tools whose assignment names that truck", async () => {
    /* The `vehicleType === "truck"` half of the containment branch. The trailer
       path is covered above; without this, a typo swapping truckId for
       trailerId in that ternary would pass every other test in this file. */
    const assetId = await newAsset();
    const truckLoc = (await db.query.vehicle.findFirst({ where: eq(schema.vehicle.id, truckId) }))!.locationId;
    const [yard] = await db
      .insert(schema.location)
      .values({ tenantId, type: "warehouse", name: "STI-207 Truck Yard" })
      .returning({ id: schema.location.id });

    /* Aboard the TRUCK by assignment, parked in a yard by location. */
    await assignmentRouter
      .createCaller(ctx)
      .create({ assetId, custodianId: empA, truckId, locationId: yard!.id });

    /* A decoy on the TRAILER: it must NOT move when the truck is handed over
       directly, or the branch is reading the wrong column. */
    const decoyId = await newAsset();
    await assignmentRouter
      .createCaller(ctx)
      .create({ assetId: decoyId, custodianId: empA, trailerId, locationId: yard!.id });

    await locationRouter.createCaller(ctx).setCustodian({
      locationId: truckLoc,
      custodianEmployeeId: empB,
      moveContents: true,
    });

    const [moved] = await db
      .select({ custodianId: schema.asset.currentCustodianId })
      .from(schema.asset)
      .where(eq(schema.asset.id, assetId));
    expect(moved!.custodianId).toBe(empB);

    const [decoy] = await db
      .select({ custodianId: schema.asset.currentCustodianId })
      .from(schema.asset)
      .where(eq(schema.asset.id, decoyId));
    expect(decoy!.custodianId).toBe(empA); // the trailer's tool stayed put

    /* The truck is carried forward, and the tool did not get relocated. */
    const events = (await db
      .select()
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)))) as unknown as EventEnvelope[];
    const folded = foldAssetState(events);
    expect(folded.truckId).toBe(truckId);
    expect(folded.locationId).toBe(yard!.id);
  });

  it("a NON-vehicle container still moves its tools by location", async () => {
    /* The other half of the STI-207 split, and the reason it is a split rather
       than a wholesale migration: a gang box has no `trailerId` to be aboard
       of. For a container that is not a vehicle, `current_location_id` is the
       only signal there is and stays authoritative. */
    const assetId = await newAsset();
    const [box] = await db
      .insert(schema.location)
      .values({ tenantId, type: "warehouse", name: "STI-207 Gang Box" })
      .returning({ id: schema.location.id });

    await assignmentRouter.createCaller(ctx).create({ assetId, custodianId: empA, locationId: box!.id });

    await locationRouter.createCaller(ctx).setCustodian({
      locationId: box!.id,
      custodianEmployeeId: empB,
      moveContents: true,
    });

    const [after] = await db
      .select({ custodianId: schema.asset.currentCustodianId })
      .from(schema.asset)
      .where(eq(schema.asset.id, assetId));
    expect(after!.custodianId).toBe(empB);
  });

  it("a vehicle referenced ONLY from a transfer row refuses delete and type flip with a sentence, not a 500", async () => {
    /* QA-203's reproduction: the guards were written against assignment refs
       before 0017 widened the FK surface — transfer_to_truck_fk /
       transfer_to_trailer_fk reference the same vehicle rows, and the writers
       park the rig on EVERY transfer row (pending, declined and completed
       alike). A vehicle named once in a declined transfer sailed past the
       guard and died on the raw FK as a 500 with no userMessage. */
    const assetId = await newAsset();
    const loneTrailer = await newVehicle(tenantId, "trailer", "TR-203-XFER");
    /* Fabricated directly: a cancelled transfer is pure paperwork (no custody,
       no ledger), and the FK does not care about status — which is the point. */
    await db.insert(schema.transfer).values({
      tenantId,
      assetId,
      toCustodianId: empA,
      toTrailerId: loneTrailer,
      status: "cancelled",
      requestedBy: userId,
    });

    const caller = vehicleRouter.createCaller(ctx);
    await expect(caller.delete({ id: loneTrailer })).rejects.toThrow(/assignment history or a transfer/);
    await expect(caller.update({ id: loneTrailer, vehicleType: "truck" })).rejects.toThrow(/assignment history or a transfer/);

    /* And the vehicle is still there — the refusal wrote nothing. */
    const v = await db.query.vehicle.findFirst({ where: eq(schema.vehicle.id, loneTrailer) });
    expect(v?.vehicleType).toBe("trailer");
  });

  it("a vehicle referenced ONLY from a closed assignment row refuses the same way", async () => {
    /* The other reference kind, independently: no transfer rows at all, one
       RETURNED assignment. The guard must not carry a status predicate. */
    const assetId = await newAsset();
    const loneTruck = await newVehicle(tenantId, "truck", "T-203-HIST");
    /* Fabricated closed row — no active link, so the STI-103 index is not in
       play, same precedent as the closed-duplicates fixture above. */
    await db.insert(schema.assignment).values({
      tenantId,
      assetId,
      custodianId: empA,
      truckId: loneTruck,
      startDate: new Date().toISOString().slice(0, 10),
      status: "returned",
    });

    const caller = vehicleRouter.createCaller(ctx);
    await expect(caller.delete({ id: loneTruck })).rejects.toThrow(/assignment history or a transfer/);
    await expect(caller.update({ id: loneTruck, vehicleType: "trailer" })).rejects.toThrow(/assignment history or a transfer/);
  });
});
