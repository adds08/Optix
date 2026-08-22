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
  let messageId: string;

  const perms = new Set<Permission>(["assignment.create", "assignment.approve", "asset.manage"]);

  const eventsFor = async (assetId: string) =>
    db
      .select({ id: schema.transaction.id })
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)));

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

    const rows = await db
      .insert(schema.asset)
      .values([
        { tenantId, tag: `STI120-A-${suffix}`, currentStatus: "available", createdBy: userId },
        { tenantId, tag: `STI120-B-${suffix}`, currentStatus: "available", createdBy: userId },
      ])
      .returning({ id: schema.asset.id });
    assetOne = rows[0]!.id;
    assetTwo = rows[1]!.id;

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
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* Ledger rows were written, so the cascade needs the sanctioned
         transactional trigger disable (0014). */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "transaction" ENABLE TRIGGER transaction_no_update_delete`);
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
});
