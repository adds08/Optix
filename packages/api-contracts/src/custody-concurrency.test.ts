import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { approveTaskAction, confirmMessageAction } from "./approve.js";
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
  let channelId: string;
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
    /* A pool-wedge red run (the STI-117 pool test against a broken shape)
       starves afterAll of a connection and strands this suite's throwaway
       tenant. Sweep any such residue from earlier runs — same sanctioned
       teardown afterAll uses — so the shared database stays clean. */
    const stale = await db
      .select({ id: schema.tenant.id })
      .from(schema.tenant)
      .where(sql`slug like 'sti109-%'`);
    for (const staleTenant of stale) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, staleTenant.id));
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
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
    /* message.channel_id is NOT NULL — the chat-confirm race tests need one. */
    const [ch] = await db
      .insert(schema.channel)
      .values({ tenantId, name: "STI-117 channel", slug: `sti117-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.channel.id });
    channelId = ch!.id;

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
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    };
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* This tenant owns ledger rows, so a bare cascade delete would be blocked
         by the 0014 append-only triggers. Same sanctioned transactional
         disable/enable the STI-113 test and the seed's wipe use. */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
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

  it("two simultaneous chat-request approves: one wins, one CONFLICT, one ledger event (STI-117)", async () => {
    for (let i = 0; i < 5; i++) {
      const assetId = await newAsset();
      /* A field request exactly as requestChatAction stores it — approving it
         replays this pendingAction through applyChatAction. Fabricated
         directly for the same reason as the pending assignment above: the race
         under test is the approve, not how the request got queued. Before
         STI-117 the status guard ran outside any transaction, so both taps
         read "pending" and each replayed the action into the ledger. */
      const [pendingTask] = await db
        .insert(schema.task)
        .values({
          tenantId,
          title: "Assign request: STI-117 rotary hammer",
          status: "pending",
          actionType: "assign",
          pendingAction: {
            type: "assign",
            assetIds: [assetId],
            custodianId: empA,
            projectId: null,
            locationId: null,
            note: null,
            draft: null,
          },
        })
        .returning({ id: schema.task.id });

      const results = await Promise.allSettled([
        approveTaskAction(ctx, pendingTask!.id),
        approveTaskAction(ctx, pendingTask!.id),
      ]);
      expectOneWinner(results);

      /* Exactly one ledger event on the asset — the loser must not replay the
         pendingAction a second time into an append-only ledger. */
      const events = await db
        .select({
          eventType: schema.transaction.eventType,
          toState: schema.transaction.toState,
        })
        .from(schema.transaction)
        .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)));
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe("assign");
      /* Complete snapshot — the fold replaces, it does not merge. Since
         STI-203 the chat executor is shape-aware, so the vehicle keys are
         present as explicit nulls even when nothing named a rig. */
      expect(events[0]!.toState).toEqual({
        status: "assigned",
        custodianId: empA,
        projectId: null,
        locationId: null,
        truckId: null,
        trailerId: null,
      });

      const row = await db.query.task.findFirst({ where: eq(schema.task.id, pendingTask!.id) });
      expect(row?.status).toBe("completed");
    }
  });

  it("two simultaneous chat confirms: one wins, one CONFLICT, one ledger event, one assignment (STI-117)", async () => {
    for (let i = 0; i < 5; i++) {
      const assetId = await newAsset();
      /* The chat Confirm button's path — a message the worker has parsed and
         proposed an action for, exactly as it sits when a phone user taps
         Confirm twice on a slow connection. QA reproduced the unguarded shape
         in a real browser: two clicks, two assign events, two assignment rows,
         the first spuriously closed as "transferred" — a hand-off that never
         happened, permanent in the ledger. */
      const [msg] = await db
        .insert(schema.message)
        .values({
          tenantId,
          channelId,
          authorUserId: userId,
          body: "give the rotary hammer to Foreman A",
          processingStatus: "action_proposed",
          proposedAction: { type: "assign", assetIds: [assetId], custodianId: empA, note: "STI-117 msg race" },
        })
        .returning({ id: schema.message.id });

      const results = await Promise.allSettled([
        confirmMessageAction(ctx, msg!.id),
        confirmMessageAction(ctx, msg!.id),
      ]);
      expectOneWinner(results);

      const events = await db
        .select({ eventType: schema.transaction.eventType, toState: schema.transaction.toState })
        .from(schema.transaction)
        .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)));
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe("assign");
      /* Same shape-aware snapshot as the task-approve path above (STI-203). */
      expect(events[0]!.toState).toEqual({
        status: "assigned",
        custodianId: empA,
        projectId: null,
        locationId: null,
        truckId: null,
        trailerId: null,
      });

      /* One custody link, active — not two with the first closed as a
         transfer that never happened. */
      const links = await db
        .select({ status: schema.assignment.status })
        .from(schema.assignment)
        .where(and(eq(schema.assignment.tenantId, tenantId), eq(schema.assignment.assetId, assetId)));
      expect(links).toHaveLength(1);
      expect(links[0]!.status).toBe("active");

      const m = await db.query.message.findFirst({ where: eq(schema.message.id, msg!.id) });
      expect(m?.processingStatus).toBe("action_executed");
      expect(m?.executedTransactionIds).toHaveLength(1);
    }
  });

  /* FINDING 1 of the STI-117 QA round: the first fix held ctx.db.transaction
     open across applyChatAction, which acquires its OWN connection — so
     pool-size concurrent approves on DISTINCT tasks pinned every connection
     (max: 10, packages/db/src/index.ts) while each waited for one more:
     client-side starvation Postgres's deadlock detector cannot see, wedging
     the whole shared pool. Claim-then-act must never hold a connection while
     acquiring another, so all N here must complete. */
  it("pool-size concurrent chat-request approves on distinct tasks all complete (STI-117)", { timeout: 20000 }, async () => {
    const N = 10; // == pool max in packages/db/src/index.ts
    const items: { taskId: string; assetId: string }[] = [];
    for (let i = 0; i < N; i++) {
      const assetId = await newAsset();
      const [t] = await db
        .insert(schema.task)
        .values({
          tenantId,
          title: `Assign request ${i}: STI-117 pool`,
          status: "pending",
          actionType: "assign",
          pendingAction: {
            type: "assign",
            assetIds: [assetId],
            custodianId: empA,
            projectId: null,
            locationId: null,
            note: null,
            draft: null,
          },
        })
        .returning({ id: schema.task.id });
      items.push({ taskId: t!.id, assetId });
    }

    const results = await Promise.allSettled(items.map((it) => approveTaskAction(ctx, it.taskId)));
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.map((r) => String(r.reason))).toEqual([]);

    /* Every apply really landed — one assign event per asset, not merely N
       resolved promises. */
    for (const it of items) {
      const events = await db
        .select({ id: schema.transaction.id })
        .from(schema.transaction)
        .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, it.assetId)));
      expect(events).toHaveLength(1);
    }
  });

  /* The un-claim half of claim-then-act: the claim writes the terminal state
     BEFORE the action applies, so a failed apply must put the row back or the
     request reads as done while nothing happened. Both tests fail the apply
     with a pendingAction naming an asset that does not exist, then prove the
     row is confirmable again — the second attempt must fail on the APPLY
     again, not on the claim, which is the difference between "un-claimed" and
     "stranded". */
  it("a failed apply un-claims the task: back to pending, approvable again (STI-117)", async () => {
    const [pendingTask] = await db
      .insert(schema.task)
      .values({
        tenantId,
        title: "Assign request: tool that does not exist",
        status: "pending",
        actionType: "assign",
        pendingAction: {
          type: "assign",
          assetIds: [crypto.randomUUID()],
          custodianId: empA,
          projectId: null,
          locationId: null,
          note: null,
          draft: null,
        },
      })
      .returning({ id: schema.task.id });

    await expect(approveTaskAction(ctx, pendingTask!.id)).rejects.toThrow(/No matching assets/);
    const afterFirst = await db.query.task.findFirst({ where: eq(schema.task.id, pendingTask!.id) });
    expect(afterFirst?.status).toBe("pending");
    expect(afterFirst?.completedAt).toBeNull();

    /* Apply error again — NOT "already completed" — proves the claim released. */
    await expect(approveTaskAction(ctx, pendingTask!.id)).rejects.toThrow(/No matching assets/);
  });

  it("a failed apply un-claims the message: back to action_proposed, confirmable again (STI-117)", async () => {
    const [msg] = await db
      .insert(schema.message)
      .values({
        tenantId,
        channelId,
        authorUserId: userId,
        body: "give the ghost tool to Foreman A",
        processingStatus: "action_proposed",
        proposedAction: { type: "assign", assetIds: [crypto.randomUUID()], custodianId: empA },
      })
      .returning({ id: schema.message.id });

    await expect(confirmMessageAction(ctx, msg!.id)).rejects.toThrow(/No matching assets/);
    const afterFirst = await db.query.message.findFirst({ where: eq(schema.message.id, msg!.id) });
    expect(afterFirst?.processingStatus).toBe("action_proposed");

    await expect(confirmMessageAction(ctx, msg!.id)).rejects.toThrow(/No matching assets/);
  });

  /* UI-89 / UI-90: the create-side race. `transfer.create`'s "one open hand-off
     per tool" check ran on ctx.db before the transaction and had no database
     backstop, so two rapid submits both inserted a pending row — one physical
     hand-off, two Moving-tab rows and two custody-chain lines at the same
     minute. The check now runs inside the transaction behind the asset-row
     lock. Needs a high-value tool so the outcome is "approve" (a pending row);
     the auto path completes and moves custody, which the STI-102 lock already
     serialises. */
  it("two simultaneous transfer creates for one tool: one pending row, one CONFLICT", async () => {
    const caller = transferRouter.createCaller({
      ...ctx,
      session: { ...ctx.session, permissions: new Set<Permission>([...ctx.session.permissions, "transfer.create"]) },
    });
    /* Throwaway tenant, no settings row yet — plain insert. `tenant_settings`
       carries no unique on tenant_id (.claude/rules/database.md), so there is
       nothing to upsert against. */
    await db.insert(schema.tenantSettings).values({ tenantId, highValueThreshold: 1 });

    for (let i = 0; i < 5; i++) {
      const [asset] = await db
        .insert(schema.asset)
        .values({ tenantId, description: "UI-90 generator", acquisitionCost: "5000" })
        .returning({ id: schema.asset.id });

      const results = await Promise.allSettled([
        caller.create({ assetId: asset!.id, toCustodianId: empB }),
        caller.create({ assetId: asset!.id, toCustodianId: empB }),
      ]);
      expectOneWinner(results);

      const rows = await db
        .select({ id: schema.transfer.id })
        .from(schema.transfer)
        .where(and(eq(schema.transfer.tenantId, tenantId), eq(schema.transfer.assetId, asset!.id)));
      expect(rows).toHaveLength(1);
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
