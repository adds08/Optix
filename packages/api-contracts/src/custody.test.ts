import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import { reconcileProjections, type EventEnvelope } from "@stinventory/domain";
import type { Permission } from "@stinventory/types";
import { closeActiveCustody, moveCustody } from "./custody.js";
import { assignmentRouter } from "./routers/assignment.js";
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
    const [p] = await db.insert(schema.project).values({ tenantId, name: "STI-113 substation" }).returning({ id: schema.project.id });
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
        await tx.execute(sql`ALTER TABLE "transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "transaction" ENABLE TRIGGER transaction_no_update_delete`);
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

    /* And the return event itself carries the complete four-key snapshot. */
    const returnEvent = events.filter((e) => e.eventType === "return").at(-1);
    expect(returnEvent?.toState).toEqual({
      status: "available",
      custodianId: null,
      projectId: null,
      locationId,
    });

    /* The link itself closed. */
    const link = await db.query.assignment.findFirst({ where: eq(schema.assignment.id, assignmentId) });
    expect(link?.status).toBe("returned");
  });
});
