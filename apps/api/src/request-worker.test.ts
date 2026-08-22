import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import { sweepRequests } from "./request-worker.js";

/*
  STI-120 gap 1 — a stalled message must always become reachable again.

  `attempts` counts PARSE attempts. `unstickProcessing` used to reuse it as a
  general give-up counter for every `processing` row, which stranded one class
  of message permanently: burn all four parse attempts (three failures then a
  success), then die inside the CONFIRM claim, and `attempts < 4` is false
  forever. The row stays `processing`, the card stops rendering as actionable,
  and a user watches a request stop existing. Silent, and permanent.

  Raising the ceiling to five was the obvious fix and the wrong one — it moves
  the cliff. The two claims are now told apart by `proposedAction`, and only
  the parse half consults the counter.

  These tests are the first in `apps/api`, which had none. They need real
  Postgres (`DATABASE_URL`) and use throwaway tenants.
*/
const url = process.env.DATABASE_URL;

/* `STUCK_PROCESSING_MS` is five minutes; the fixtures backdate past it. */
const LONG_AGO = new Date(Date.now() - 30 * 60_000);

describe.skipIf(!url)("request worker: unsticking stalled messages (STI-120)", () => {
  let db: Database;
  let tenantId: string;
  let channelId: string;

  const suffix = crypto.randomUUID().slice(0, 8);

  /* `updatedAt` has a default, and the sweep's whole predicate is "older than
     the cutoff" — so it must be forced, not relied on. */
  const backdate = async (id: string) =>
    db.update(schema.message).set({ updatedAt: LONG_AGO }).where(eq(schema.message.id, id));

  const makeMessage = async (over: Partial<typeof schema.message.$inferInsert>) => {
    const [m] = await db
      .insert(schema.message)
      .values({ tenantId, channelId, body: "stalled", processingStatus: "processing", ...over })
      .returning({ id: schema.message.id });
    await backdate(m!.id);
    return m!.id;
  };

  const statusOf = async (id: string) => {
    const [row] = await db
      .select({ status: schema.message.processingStatus, attempts: schema.message.attempts })
      .from(schema.message)
      .where(eq(schema.message.id, id));
    return row!;
  };

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-120 worker test", slug: `sti120w-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [c] = await db
      .insert(schema.channel)
      .values({ tenantId, name: "STI-120 worker", slug: `sti120w-${suffix}` })
      .returning({ id: schema.channel.id });
    channelId = c!.id;
  });

  afterAll(async () => {
    if (db && tenantId) await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
    await db?.$client.end();
  });

  it("re-arms a confirm stalled at the attempts CEILING — the permanent stranding", async () => {
    /*
      The exact shape of gap 1: `attempts = 4` (the ceiling), stuck
      `processing`, and carrying a `proposedAction` — which is only true of a
      message claimed by CONFIRM, because `confirmMessageAction` refuses
      anything not already `action_proposed`.

      Before the split this row could never be re-queued and the Confirm button
      never came back.
    */
    const id = await makeMessage({ attempts: 4, proposedAction: { type: "lost", assetIds: [] } });

    await sweepRequests(db);

    const after = await statusOf(id);
    expect(after.status, "a confirm at the ceiling is still stranded").toBe("action_proposed");
    /* No attempt counted: re-arming a button is not a parse. */
    expect(after.attempts).toBe(4);
  });

  it("re-arms a confirm stalled below the ceiling too", async () => {
    const id = await makeMessage({ attempts: 1, proposedAction: { type: "lost", assetIds: [] } });
    await sweepRequests(db);
    expect((await statusOf(id)).status).toBe("action_proposed");
  });

  it("still re-queues a stalled PARSE, and counts the attempt", async () => {
    /* No `proposedAction` means the parser claimed it and died. That half is
       unchanged: back to the queue, attempt counted. */
    const id = await makeMessage({ attempts: 1, proposedAction: null });
    await sweepRequests(db);
    const after = await statusOf(id);
    expect(after.status).toBe("queued");
    expect(after.attempts).toBe(2);
  });

  it("still gives up on a parse that has burned its attempts", async () => {
    /*
      The ceiling has to keep meaning something, or a message the parser cannot
      handle is retried forever. It stays `processing` and the desk resolves it
      by hand — which is the intended end state, not a bug.
    */
    const id = await makeMessage({ attempts: 4, proposedAction: null });
    await sweepRequests(db);
    const after = await statusOf(id);
    expect(after.status).toBe("processing");
    expect(after.attempts).toBe(4);
  });

  it("leaves a recently-claimed message alone", async () => {
    /* Without the cutoff the sweep would rip messages out from under a worker
       that is actively parsing them. */
    const [m] = await db
      .insert(schema.message)
      .values({ tenantId, channelId, body: "in flight", processingStatus: "processing", attempts: 1 })
      .returning({ id: schema.message.id });

    await sweepRequests(db);

    expect((await statusOf(m!.id)).status).toBe("processing");
  });

  it("does not touch a message that is not stuck at all", async () => {
    const [m] = await db
      .insert(schema.message)
      .values({ tenantId, channelId, body: "settled", processingStatus: "action_executed" })
      .returning({ id: schema.message.id });
    await backdate(m!.id);

    await sweepRequests(db);

    expect((await statusOf(m!.id)).status).toBe("action_executed");
  });
});
