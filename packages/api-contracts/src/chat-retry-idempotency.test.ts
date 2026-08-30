import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { applyChatAction } from "./apply-action.js";

/*
  STI-120, gap 2a — a retry must not append a second ledger event.

  The ticket was opened as a narrow crash-window concern and QA then showed
  something worse: **no crash is required.** `applyChatAction` writes one asset
  at a time, each in its own transaction, so a five-asset action that fails on
  the third leaves two applied and three not. `confirmMessageAction` catches,
  un-claims the message back to `action_proposed`, and the Confirm button works
  again. Pressing it re-ran the entire list.

  What that costs is specific to this system: the ledger is append-only and
  enforced by a trigger, so a duplicate `assign` event for a tool that already
  moved is **permanent**. It cannot be deleted, and `foldAssetState` is
  last-snapshot-wins so the projection still looks right — the history is
  wrong and nothing reports it. That is the expensive class of bug in this
  codebase: the projection and the ledger agree with each other and both
  misdescribe what happened.

  The fix uses the ledger as its own idempotency key — every event this path
  writes carries `refType: "message"` and `refId: <messageId>`, so "has this
  message already moved this asset" is a question the log itself answers.

  This test drives the real `applyChatAction` against real Postgres and counts
  rows. Asserting on the return value alone would pass for an implementation
  that double-writes and reports once.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("chat retry does not duplicate ledger events (STI-120)", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;
  let custodianId: string;
  let projectId: string;
  let assetOne: string;
  let assetTwo: string;
  let assetHighValue: string;
  let messageId: string;
  let handoffMessageOne: string;
  let handoffMessageTwo: string;

  const perms = new Set<Permission>([
    "assignment.create",
    "assignment.approve",
    "transfer.create",
    "asset.manage",
  ]);

  const eventsFor = async (assetId: string) =>
    db
      .select({ id: schema.transaction.id })
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)));

  /* UI-66 counts ROWS, not the reported `awaitingApproval` — an implementation
     that writes twice and reports once would pass the return value. */
  const transfersFor = async (assetId: string) =>
    db
      .select({ id: schema.transfer.id })
      .from(schema.transfer)
      .where(and(eq(schema.transfer.tenantId, tenantId), eq(schema.transfer.assetId, assetId)));

  beforeAll(async () => {
    db = createDb(url!);
    const suffix = crypto.randomUUID().slice(0, 8);

    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-120 retry test", slug: `sti120-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;

    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: `sti120-${suffix}@test.local`, passwordHash: "not-a-real-hash", firstName: "STI", lastName: "OneTwenty" })
      .returning({ id: schema.user.id });
    userId = u!.id;

    const [e] = await db.insert(schema.employee).values({ tenantId, name: "Foreman OneTwenty" }).returning({ id: schema.employee.id });
    custodianId = e!.id;

    const [p] = await db.insert(schema.project).values({ tenantId, name: "STI-120 job" }).returning({ id: schema.project.id });
    projectId = p!.id;

    /* Pin the gate here rather than leaning on DEFAULT_HIGH_VALUE_THRESHOLD, so
       the UI-66 fixture below is high-value because this test says so. */
    await db.insert(schema.tenantSettings).values({ tenantId, highValueThreshold: 5000 });

    const rows = await db
      .insert(schema.asset)
      .values([
        { tenantId, tag: `STI120-A-${suffix}`, currentStatus: "available", createdBy: userId },
        { tenantId, tag: `STI120-B-${suffix}`, currentStatus: "available", createdBy: userId },
        /* Priced over the threshold, so `custodyOutcome` returns "approve" and
           the hand-off is withheld for a second signature — the branch UI-66
           lives in, which writes a `transfer` row and NO ledger row. */
        { tenantId, tag: `UI66-${suffix}`, currentStatus: "available", acquisitionCost: "9500.00", createdBy: userId },
      ])
      .returning({ id: schema.asset.id });
    assetOne = rows[0]!.id;
    assetTwo = rows[1]!.id;
    assetHighValue = rows[2]!.id;

    /* A real message row: `refId` is an FK-free uuid on `transaction`, but the
       guard is only meaningful if the id names something that exists. */
    const [ch] = await db
      .insert(schema.channel)
      .values({ tenantId, name: "STI-120", slug: `sti120-${suffix}` })
      .returning({ id: schema.channel.id });
    const [m] = await db
      .insert(schema.message)
      .values({ tenantId, channelId: ch!.id, authorUserId: userId, body: "took both of these", processingStatus: "action_proposed" })
      .returning({ id: schema.message.id });
    messageId = m!.id;

    /* Two messages naming the same tool: one is re-confirmed, the other is a
       second sentence about the same hand-off (UI-66). */
    const handoffs = await db
      .insert(schema.message)
      .values([
        { tenantId, channelId: ch!.id, authorUserId: userId, body: "give the generator to the foreman", processingStatus: "action_proposed" },
        { tenantId, channelId: ch!.id, authorUserId: userId, body: "generator goes to the foreman", processingStatus: "action_proposed" },
      ])
      .returning({ id: schema.message.id });
    handoffMessageOne = handoffs[0]!.id;
    handoffMessageTwo = handoffs[1]!.id;
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* Ledger rows were written, so the cascade needs the sanctioned
         transactional trigger disable (0014). */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("applies both assets the first time", async () => {
    const res = await applyChatAction(db, {
      tenantId,
      actorUserId: userId,
      actorEmployeeId: null,
      permissions: perms,
      action: { type: "assign", assetIds: [assetOne, assetTwo], custodianId, projectId },
      refMessageId: messageId,
    });

    expect(res.applied).toBe(2);
    expect(await eventsFor(assetOne)).toHaveLength(1);
    expect(await eventsFor(assetTwo)).toHaveLength(1);
  });

  it("re-running the SAME message writes no second event — the retry QA reproduced", async () => {
    /* This is the whole ticket. Before the guard, this call appended a second
       `assign` event to each asset: a hand-off that never happened, permanent,
       in a log that cannot be pruned. */
    await applyChatAction(db, {
      tenantId,
      actorUserId: userId,
      actorEmployeeId: null,
      permissions: perms,
      action: { type: "assign", assetIds: [assetOne, assetTwo], custodianId, projectId },
      refMessageId: messageId,
    });

    expect(await eventsFor(assetOne), "a retry appended a duplicate event").toHaveLength(1);
    expect(await eventsFor(assetTwo), "a retry appended a duplicate event").toHaveLength(1);
  });

  it("still reports the whole action as applied, not just the part it did", async () => {
    /* A retry that returned "0 applied" would read to the caller as a failure
       and to the user as "nothing happened", when in fact the work is
       complete. The skipped assets are counted and their existing ledger ids
       returned. */
    const res = await applyChatAction(db, {
      tenantId,
      actorUserId: userId,
      actorEmployeeId: null,
      permissions: perms,
      action: { type: "assign", assetIds: [assetOne, assetTwo], custodianId, projectId },
      refMessageId: messageId,
    });

    expect(res.applied).toBe(2);
    expect(res.transactionIds).toHaveLength(2);
  });

  it("leaves custody where the first apply put it", async () => {
    /* The projection is last-write-wins, so it would look correct even if the
       retry HAD re-applied. Asserting one active link is what proves the
       second apply did not open a second one. */
    const links = await db
      .select({ id: schema.assignment.id, custodianId: schema.assignment.custodianId })
      .from(schema.assignment)
      .where(and(eq(schema.assignment.tenantId, tenantId), eq(schema.assignment.assetId, assetOne), eq(schema.assignment.status, "active")));

    expect(links).toHaveLength(1);
    expect(links[0]!.custodianId).toBe(custodianId);
  });

  it("does NOT skip a direct form apply, which carries no message", async () => {
    /* The guard is keyed on `refMessageId`. A form has none, and each press of
       a form button is a genuinely new instruction — returning a tool and
       re-issuing it must both be recorded. Suppressing that would be a worse
       bug than the one being fixed. */
    const before = (await eventsFor(assetTwo)).length;

    await applyChatAction(db, {
      tenantId,
      actorUserId: userId,
      actorEmployeeId: null,
      permissions: perms,
      action: { type: "assign", assetIds: [assetTwo], custodianId, projectId },
    });

    expect((await eventsFor(assetTwo)).length).toBe(before + 1);
  });

  /*
    UI-66 — the withheld hand-off branch, which the guard above cannot reach.

    A high-value hand-off writes a `pending_approval` transfer row and NO ledger
    event, so "has this message already moved this asset" is a question the log
    can never answer yes to. Nothing else stopped a second row: there is no
    unique index on `transfer`. The desk got two queue entries for one physical
    event — approve one and the other waits forever.
  */
  it("a re-confirmed hand-off does not queue a second pending transfer (UI-66)", async () => {
    const opts = {
      tenantId,
      actorUserId: userId,
      actorEmployeeId: null,
      permissions: perms,
      action: { type: "transfer", assetIds: [assetHighValue], custodianId, projectId },
      refMessageId: handoffMessageOne,
    };

    await applyChatAction(db, opts);
    await applyChatAction(db, opts); // the retry, after an un-claim

    expect(await transfersFor(assetHighValue), "a retry queued a duplicate hand-off").toHaveLength(1);
    /* Nothing moved: the register still waits on the desk. */
    expect(await eventsFor(assetHighValue)).toHaveLength(0);
  });

  it("a SECOND message about the same tool does not queue one either", async () => {
    /* The reproduction that needs no crash and no retry: two sentences about
       one hand-off. Keyed on the message, the STI-120 guard is blind to this
       even in principle — the ids differ. */
    await applyChatAction(db, {
      tenantId,
      actorUserId: userId,
      actorEmployeeId: null,
      permissions: perms,
      action: { type: "transfer", assetIds: [assetHighValue], custodianId, projectId },
      refMessageId: handoffMessageTwo,
    });

    expect(await transfersFor(assetHighValue), "a second message queued a duplicate hand-off").toHaveLength(1);
  });
});
