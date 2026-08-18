import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { moveCustody } from "./custody.js";
import { assignmentRouter } from "./routers/assignment.js";
import { transferRouter } from "./routers/transfer.js";
import type { Context } from "./trpc.js";

/*
  STI-109 / STI-114: the decision procedures re-check the row's status under
  the asset-row lock. Before this, the status guard ran outside the
  transaction, so two simultaneous approves (or returns) both read "still
  pending" (or "still active") and both wrote — the custody invariant held,
  but the loser appended a second identical event to an append-only ledger
  that can never be pruned. Both the STI-102 developer's disclosure and QA's
  independent reproduction used a live race, so these do too.

  Same harness rules as custody.test.ts: real Postgres via DATABASE_URL
  (skipped without it), everything under a throwaway tenant, and — because
  these DO write ledger rows — cleanup uses the sanctioned transactional
  trigger disable around the cascade delete.

  Lives in its own file rather than custody.test.ts so the STI-102/103 suite
  and this one stay independently readable.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("double decisions write exactly one ledger event (STI-109, STI-114)", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;
  let empA: string;
  let empB: string;
  let locationId: string;
  let ctx: Context;

  async function newAsset(): Promise<string> {
    const [row] = await db
      .insert(schema.asset)
      .values({ tenantId, description: "STI-109 rotary hammer" })
      .returning({ id: schema.asset.id });
    return row!.id;
  }

  const eventsFor = (refType: "assignment" | "transfer", refId: string) =>
    db
      .select({ id: schema.transaction.id, eventType: schema.transaction.eventType })
      .from(schema.transaction)
      .where(
        and(
          eq(schema.transaction.tenantId, tenantId),
          eq(schema.transaction.refType, refType),
          eq(schema.transaction.refId, refId),
        ),
      );

  /* One fulfilled, one CONFLICT — the loser must hear it lost (STI-109
     criterion 2): a caller that believes it approved something it did not is
     worse than an error. */
  function expectOneWinner(results: PromiseSettledResult<unknown>[]) {
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]!.reason)).toMatch(/already/);
  }

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-109 race test", slug: `sti109-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: "sti109@test.local", passwordHash: "not-a-real-hash", firstName: "STI", lastName: "OneOhNine" })
      .returning({ id: schema.user.id });
    userId = u!.id;
    const [a] = await db.insert(schema.employee).values({ tenantId, name: "Foreman A" }).returning({ id: schema.employee.id });
    const [b] = await db.insert(schema.employee).values({ tenantId, name: "Foreman B" }).returning({ id: schema.employee.id });
    empA = a!.id;
    empB = b!.id;
    const [l] = await db
      .insert(schema.location)
      .values({ tenantId, type: "warehouse", name: "STI-109 yard" })
      .returning({ id: schema.location.id });
    locationId = l!.id;

    ctx = {
      db,
      session: {
        userId,
        tenantId,
        employeeId: null,
        permissions: new Set<Permission>(["assignment.create", "assignment.approve", "transfer.approve"]),
        roleName: null,
        actorLabel: null,
      },
      sessionSecret: "sti109-test-secret",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    };
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* This tenant owns ledger rows, so a bare cascade delete would be blocked
         by the 0014 append-only triggers. Same sanctioned transactional
         disable/enable the STI-113 test and the seed's wipe use. */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("two simultaneous assignment approves: one wins, one CONFLICT, one ledger event", async () => {
    const caller = assignmentRouter.createCaller(ctx);
    /* Raced several times, like the STI-102 suite: an interleaving bug that
       only fails sometimes is still a bug. */
    for (let i = 0; i < 5; i++) {
      const assetId = await newAsset();
      /* Fabricated directly on purpose: a pending row is a proposal, not
         custody — the chokepoint only ever writes active links, and the
         STI-103 index only constrains status = 'active'. Going through
         assignment.create would drag tenant settings and acquisition costs
         into a test that is about the approve race, not the gate. */
      const [pending] = await db
        .insert(schema.assignment)
        .values({
          tenantId,
          assetId,
          custodianId: empA,
          startDate: new Date().toISOString().slice(0, 10),
          status: "pending_approval",
        })
        .returning({ id: schema.assignment.id });

      const results = await Promise.allSettled([
        caller.approve({ id: pending!.id }),
        caller.approve({ id: pending!.id }),
      ]);
      expectOneWinner(results);

      /* The heart of STI-109: exactly one "Assignment approved" event. Two
         rows sharing this ref_id is the audit pollution QA reproduced. */
      const events = await eventsFor("assignment", pending!.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe("assign");

      const row = await db.query.assignment.findFirst({ where: eq(schema.assignment.id, pending!.id) });
      expect(row?.status).toBe("active");
    }
  });

  it("two simultaneous transfer approves: one wins, one CONFLICT, one ledger event", async () => {
    const caller = transferRouter.createCaller(ctx);
    for (let i = 0; i < 5; i++) {
      const assetId = await newAsset();
      const [pending] = await db
        .insert(schema.transfer)
        .values({
          tenantId,
          assetId,
          toCustodianId: empB,
          status: "pending_approval",
          requestedBy: userId,
        })
        .returning({ id: schema.transfer.id });

      const results = await Promise.allSettled([
        caller.approve({ id: pending!.id }),
        caller.approve({ id: pending!.id }),
      ]);
      expectOneWinner(results);

      const events = await eventsFor("transfer", pending!.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe("transfer");

      const row = await db.query.transfer.findFirst({ where: eq(schema.transfer.id, pending!.id) });
      expect(row?.status).toBe("completed");
    }
  });

  it("two simultaneous returns: one returned row, one ledger event, returnedAt set (STI-114)", async () => {
    const caller = assignmentRouter.createCaller(ctx);
    for (let i = 0; i < 5; i++) {
      const assetId = await newAsset();
      /* An assigned tool with a location, opened through the chokepoint — the
         state every real return starts from. */
      const { openedId } = await db.transaction((tx) =>
        moveCustody(tx, { tenantId, assetId, toCustodianId: empA, projectId: null, locationId, actorUserId: userId }),
      );
      await db
        .update(schema.asset)
        .set({ currentStatus: "assigned", currentCustodianId: empA, currentLocationId: locationId })
        .where(eq(schema.asset.id, assetId));

      const results = await Promise.allSettled([
        caller.return({ id: openedId! }),
        caller.return({ id: openedId! }),
      ]);
      expectOneWinner(results);

      /* Exactly one return event — the double return used to append a
         duplicate into the append-only ledger (same class as STI-109). */
      const events = await eventsFor("assignment", openedId!);
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe("return");

      /* The close now runs through closeActiveCustody, which owns returnedAt
         (STI-114 criterion 6) — verify it still gets stamped. */
      const link = await db.query.assignment.findFirst({ where: eq(schema.assignment.id, openedId!) });
      expect(link?.status).toBe("returned");
      expect(link?.returnedAt).not.toBeNull();

      /* Return semantics unchanged (STI-113): nobody holds it, no project,
         last known location stands. */
      const asset = await db.query.asset.findFirst({ where: eq(schema.asset.id, assetId) });
      expect(asset?.currentStatus).toBe("available");
      expect(asset?.currentCustodianId).toBeNull();
      expect(asset?.currentProjectId).toBeNull();
      expect(asset?.currentLocationId).toBe(locationId);
    }
  });
});
