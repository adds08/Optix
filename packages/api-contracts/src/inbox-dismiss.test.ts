import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { inboxRouter } from "./routers/inbox.js";
import type { Context } from "./trpc.js";

/*
  UI-72: dismissing an unrecognized item from the inbox.

  Two defects, both reported as one sentence — "Dismiss opens an unclear 'Why
  is nothing being recorded?' prompt instead of properly dismissing the task".
  The prompt copy is a UI string and is not testable here. The second half is:

  `inbox.dismiss` sets a message to `processing_status = 'dismissed'`, but
  `inbox.classified` never SELECTED that status and the completed filter never
  counted it — so a dismissed MESSAGE was in none of the three buckets and
  disappeared from the desk entirely, contradicting the header comments on both
  the router and the page. `processing_status` is plain text with no enum, so
  nothing at the database level catches a status a query forgets; this test is
  the only thing that does. Case 4 fails before the fix and passes after.

  The task half already worked (`status: "cancelled"` is in
  TERMINAL_TASK_STATUSES) — it is here to guard the path that was fine.

  Same harness rules as decline.test.ts: real Postgres via DATABASE_URL
  (skipped without it), a throwaway tenant so the shared seed is untouched.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("dismissing from the inbox lands in Completed (UI-72)", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;
  let channelId: string;
  let ctx: Context;

  /* An unrecognized message: the model could not bind it, so the worker parked
     it in `pending_manual` — exactly the row the Dismiss button acts on. */
  async function unrecognizedMessage(body: string): Promise<string> {
    const [m] = await db
      .insert(schema.message)
      .values({ tenantId, channelId, authorUserId: userId, body, processingStatus: "pending_manual" })
      .returning({ id: schema.message.id });
    return m!.id;
  }

  /* An unrecognized task: no actionType, so there is nothing to replay. */
  async function unrecognizedTask(title: string): Promise<string> {
    const [t] = await db
      .insert(schema.task)
      .values({ tenantId, title, createdByUserId: userId })
      .returning({ id: schema.task.id });
    return t!.id;
  }

  const bucketIds = async () => {
    const c = await inboxRouter.createCaller(ctx).classified({ limit: 50 });
    return {
      unrecognized: c.unrecognized.map((i) => i.id),
      completed: c.completed.map((i) => i.id),
      recognized: c.recognized.map((i) => i.id),
    };
  };

  beforeAll(async () => {
    db = createDb(url!);
    const suffix = crypto.randomUUID().slice(0, 8);

    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "UI-72 dismiss test", slug: `ui72-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;

    const [u] = await db
      .insert(schema.user)
      .values({
        tenantId,
        email: `ui72-${suffix}@test.local`,
        passwordHash: "not-a-real-hash",
        firstName: "UI",
        lastName: "SeventyTwo",
      })
      .returning({ id: schema.user.id });
    userId = u!.id;

    const [ch] = await db
      .insert(schema.channel)
      .values({ tenantId, name: "UI-72", slug: `ui72-${suffix}` })
      .returning({ id: schema.channel.id });
    channelId = ch!.id;

    ctx = {
      db,
      session: {
        userId,
        tenantId,
        employeeId: null,
        /* The whole inbox runs on the desk's read permission — `dismiss` and
           `classified` are gated on the same one. */
        permissions: new Set<Permission>(["assignment.read"]),
        roleName: null,
        actorLabel: null,
      },
      sessionSecret: "ui72-test-secret",
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    };
  });

  afterAll(async () => {
    /* No ledger rows are written here — dismiss touches only `message` and
       `task` — so the plain cascade delete is enough, with no trigger dance. */
    if (db && tenantId) await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
    await db?.$client.end();
  });

  it("a dismissed MESSAGE leaves Unrecognized and lands in Completed", async () => {
    const id = await unrecognizedMessage("boom lift wont start, sending pics");

    const before = await bucketIds();
    expect(before.unrecognized).toContain(id);
    expect(before.completed).not.toContain(id);

    /* Called with NO `reason` key at all, deliberately: the field is optional
       end to end and the server supplies its own default. A future change that
       makes the reason required fails right here rather than in the browser. */
    await inboxRouter.createCaller(ctx).dismiss({ id, kind: "message" });

    const row = await db.query.message.findFirst({
      where: and(eq(schema.message.id, id), eq(schema.message.tenantId, tenantId)),
    });
    expect(row?.processingStatus).toBe("dismissed");
    expect(row?.errorNote).toBe("Dismissed from the inbox");
    expect(row?.handledByUserId).toBe(userId);

    /* The regression: before the fix `classified` neither selected nor counted
       "dismissed", so the row was in none of the three buckets. */
    const after = await bucketIds();
    expect(after.completed).toContain(id);
    expect(after.unrecognized).not.toContain(id);
    expect(after.recognized).not.toContain(id);
  });

  it("a dismissed TASK does the same, with its reason defaulted", async () => {
    const id = await unrecognizedTask("UI-72 note nobody could parse");

    const before = await bucketIds();
    expect(before.unrecognized).toContain(id);

    await inboxRouter.createCaller(ctx).dismiss({ id, kind: "task" });

    const row = await db.query.task.findFirst({
      where: and(eq(schema.task.id, id), eq(schema.task.tenantId, tenantId)),
    });
    expect(row?.status).toBe("cancelled");
    expect(row?.classification).toBe("completed");
    expect(row?.declineReason).toBe("Dismissed from the inbox");

    const after = await bucketIds();
    expect(after.completed).toContain(id);
    expect(after.unrecognized).not.toContain(id);
  });
});
