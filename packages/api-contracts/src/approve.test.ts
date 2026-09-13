import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { approveTaskAction } from "./approve.js";
import { inboxRouter } from "./routers/inbox.js";
import { taskRouter } from "./routers/task.js";
import type { Context } from "./trpc.js";

/*
  The approve half of the request gate.

  `decline.test.ts` covers refusing a request. Granting one had no test of its
  own: `custody-concurrency.test.ts` calls `approveTaskAction` but is asking a
  different question — whether two simultaneous confirms can double-apply — and
  asserts nothing about whether a single approval moves the tool, charges the
  approver, or reaches the requester.

  That mattered because `reachability.test.ts` carried a TODO claiming the desk
  "can refuse a request from the UI and cannot grant one". It is wrong, and the
  reason it survived is that nothing exercised the path end to end. The inbox's
  "Do it" button calls `inbox.resolve`, which delegates to the SAME
  `approveTaskAction` that `task.approve` does. Three surfaces, one executor —
  that is the design in approve.ts's header, and these tests hold it to it.

  What is asserted, in the order a reviewer should care about:

    1. approving applies the action — the tool actually moves
    2. the inbox button and the explicit procedure are the same code
    3. permission is charged against the APPROVER, not the requester
    4. a request cannot be settled twice
    5. a note is not a request, and cannot be approved
    6. the requester is told

  Same harness rules as decline.test.ts: real Postgres via DATABASE_URL
  (skipped without it), a throwaway tenant, trigger-disabled cleanup because
  approving writes ledger rows.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("approving a field request", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;
  let deskEmployee: string;
  let foreman: string;
  let projectId: string;
  let locationId: string;

  /* The desk: holds the permission the action costs. */
  let ctx: Context;
  /* Somebody signed in with no custody permissions at all — the shape of a
     requester trying to approve their own request. */
  let unprivileged: Context;

  function contextWith(permissions: Permission[], employeeId: string | null = deskEmployee): Context {
    return {
      db,
      session: {
        userId,
        tenantId,
        employeeId,
        permissions: new Set<Permission>(permissions),
        roleName: null,
        actorLabel: null,
      },
      sessionSecret: "approve-test-secret",
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    };
  }

  /* A loose tool in the yard, and a pending request to hand it to the foreman
     — exactly the row `apply-action.ts` writes when a foreman without
     `asset.manage` asks for something in chat. Built directly rather than
     through the chat path so the test is about approval, not about parsing. */
  async function pendingHandoverRequest(): Promise<{ taskId: string; assetId: string }> {
    const [asset] = await db
      .insert(schema.asset)
      .values({
        tenantId,
        description: "Approve-test breaker bar",
        currentStatus: "available",
        currentLocationId: locationId,
      })
      .returning({ id: schema.asset.id });

    const [task] = await db
      .insert(schema.task)
      .values({
        tenantId,
        title: "Give the breaker bar to the foreman",
        status: "pending",
        priority: "medium",
        createdByUserId: userId,
        requestedByEmployeeId: foreman,
        source: "chat",
        actionType: "assign",
        pendingAction: {
          type: "assign",
          assetIds: [asset!.id],
          custodianId: foreman,
          projectId,
          locationId: null,
          truckId: null,
          trailerId: null,
          note: null,
          draft: null,
        },
      })
      .returning({ id: schema.task.id });

    return { taskId: task!.id, assetId: asset!.id };
  }

  const assetRow = (assetId: string) =>
    db.query.asset.findFirst({ where: and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tenantId)) });

  const taskRow = (taskId: string) =>
    db.query.task.findFirst({ where: and(eq(schema.task.id, taskId), eq(schema.task.tenantId, tenantId)) });

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "approve test", slug: `approve-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;

    const [u] = await db
      .insert(schema.user)
      .values({
        tenantId,
        email: "approve@test.local",
        passwordHash: "not-a-real-hash",
        firstName: "Desk",
        lastName: "Approver",
      })
      .returning({ id: schema.user.id });
    userId = u!.id;

    const [d] = await db.insert(schema.employee).values({ tenantId, name: "Desk Approver" }).returning({ id: schema.employee.id });
    const [f] = await db.insert(schema.employee).values({ tenantId, name: "Foreman Requester" }).returning({ id: schema.employee.id });
    deskEmployee = d!.id;
    foreman = f!.id;

    const [p] = await db
      .insert(schema.project)
      .values({ tenantId, name: "Approve-test substation", startDate: "2025-01-06" })
      .returning({ id: schema.project.id });
    projectId = p!.id;

    const [l] = await db
      .insert(schema.location)
      .values({ tenantId, type: "warehouse", name: "Approve-test yard" })
      .returning({ id: schema.location.id });
    locationId = l!.id;

    ctx = contextWith(["assignment.create", "assignment.read", "assignment.approve"]);
    unprivileged = contextWith(["assignment.read"], foreman);
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* Approving writes ledger rows, so the cascade delete needs the
         sanctioned transactional trigger disable (0014, STI-113). */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("applies the action, so the tool actually moves", async () => {
    const { taskId, assetId } = await pendingHandoverRequest();

    const before = await assetRow(assetId);
    expect(before?.currentCustodianId).toBeNull();

    const result = await taskRouter.createCaller(ctx).approve({ id: taskId });
    expect(result.applied).toBe(1);

    /* The point of the gate: the thing the foreman asked for happened, from
       the payload they asked with — not from a desk's retyped guess. */
    const after = await assetRow(assetId);
    expect(after?.currentCustodianId).toBe(foreman);
    expect(after?.currentProjectId).toBe(projectId);

    const task = await taskRow(taskId);
    expect(task?.status).toBe("completed");
  });

  it("settles the same way through the inbox button as through task.approve", async () => {
    /* The inbox's "Do it" is `inbox.resolve`, which delegates to the same
       executor. If these two ever diverge, a hand-off approved on one screen
       behaves differently from the same hand-off approved on the other, and
       the ledger stops being a single account of what happened. */
    const { taskId, assetId } = await pendingHandoverRequest();

    const result = await inboxRouter.createCaller(ctx).resolve({ id: taskId, kind: "task" });
    expect(result.outcome).toBe("applied");
    expect(result.applied).toBe(1);

    const after = await assetRow(assetId);
    expect(after?.currentCustodianId).toBe(foreman);

    const task = await taskRow(taskId);
    expect(task?.status).toBe("completed");
  });

  it("charges the approver, not the requester", async () => {
    /* Otherwise raising a request would be a way to perform an action nobody
       was allowed to perform — which would make the gate a bypass rather than
       a control. */
    const { taskId, assetId } = await pendingHandoverRequest();

    await expect(approveTaskAction(unprivileged, taskId)).rejects.toThrow(/requires/);

    /* Refused means refused: nothing moved, and the request is still waiting
       for somebody who may decide it. */
    const after = await assetRow(assetId);
    expect(after?.currentCustodianId).toBeNull();
    const task = await taskRow(taskId);
    expect(task?.status).toBe("pending");
  });

  it("refuses to settle a request twice", async () => {
    const { taskId } = await pendingHandoverRequest();
    await taskRouter.createCaller(ctx).approve({ id: taskId });

    /* CONFLICT, not BAD_REQUEST: "somebody got here first" is a race outcome
       (STI-117). The second click on a slow connection is ordinary behaviour,
       and it must not replay the payload into an append-only ledger. */
    await expect(taskRouter.createCaller(ctx).approve({ id: taskId })).rejects.toThrow(/already completed/);
  });

  it("will not approve a note, because there is nothing to apply", async () => {
    /* `task.create` writes no actionType — a manually raised task is a note.
       Approving one would have to invent an action, which is exactly what the
       stored pendingAction exists to avoid. */
    const [note] = await db
      .insert(schema.task)
      .values({
        tenantId,
        title: "Order more grinder discs",
        status: "pending",
        priority: "low",
        createdByUserId: userId,
        source: "manual",
      })
      .returning({ id: schema.task.id });

    await expect(taskRouter.createCaller(ctx).approve({ id: note!.id })).rejects.toThrow(/note, not a request/);
  });

  it("tells the requester their request was granted", async () => {
    /* The loop only closes if the foreman who asked finds out. `decline`
       writes `request_declined`; this is its counterpart, and a request that
       is silently granted looks to the field like one that was ignored. */
    const { taskId } = await pendingHandoverRequest();
    await taskRouter.createCaller(ctx).approve({ id: taskId });

    const notes = await db
      .select({ type: schema.notification.type, recipient: schema.notification.recipientEmployeeId })
      .from(schema.notification)
      .where(and(eq(schema.notification.tenantId, tenantId), eq(schema.notification.refId, taskId)));

    expect(notes.some((n) => n.type === "request_approved" && n.recipient === foreman)).toBe(true);
  });

  it("carries the approver's note to the requester and the ledger", async () => {
    /* This is the entire reason `task.approve` exists alongside
       `inbox.resolve`, which takes no note — and since 2026-09-14 the inbox's
       "With a note" button is what reaches it. A desk approving with a
       condition ("ok, but it comes back Friday") needs those words to land
       somewhere the foreman will see and the register will keep. */
    const { taskId, assetId } = await pendingHandoverRequest();
    const note = "Approved for the substation pour — back in the yard Friday.";

    await taskRouter.createCaller(ctx).approve({ id: taskId, note });

    const [delivered] = await db
      .select({ body: schema.notification.body })
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.tenantId, tenantId),
          eq(schema.notification.refId, taskId),
          eq(schema.notification.type, "request_approved"),
        ),
      );
    expect(delivered?.body).toBe(note);

    /* And onto the custody event itself, so why the hand-off was allowed is
       recorded beside the hand-off rather than only in an alert somebody can
       mark read. */
    const events = await db
      .select({ note: schema.transaction.note })
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)));
    expect(events.some((e) => e.note === note)).toBe(true);
  });
});
