import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import { createLogger } from "@stinventory/logger";
import { createNotification } from "./notifications.js";

const log = createLogger("request-worker");

/*
  The queue behind field requests.

  What this worker deliberately does NOT do is approve anything. A request
  exists precisely because the person who raised it does not hold the
  permission the action costs, so a background job that applied it after a
  timeout would be a way to obtain a permission by waiting — the exact hole the
  gate exists to close (docs/06-decisions.md ADR-4). Custody always waits for a
  person.

  What it does instead is make sure a request cannot go unnoticed:

    1. Messages stranded by infrastructure go back in the queue. If the parser
       was unreachable the message failed for a reason that has nothing to do
       with its content, and today it stays failed forever — the foreman's
       hand-off is simply lost. Those are retried, with a bounded count so a
       genuinely bad message ends up at the desk rather than looping.

    2. New requests raise a notification for the owning desk, and aging ones
       are chased on a widening interval. A request nobody looks at is the
       failure mode this queue is for.
*/

/* Enough retries to ride out a parser restart or a model reload, few enough
   that a message which always fails reaches a human the same shift. */
const MAX_PARSE_ATTEMPTS = 4;

/* A message left `processing` longer than this had its worker die mid-flight —
   nothing else takes that long, and without this it is stuck forever. */
const STUCK_PROCESSING_MS = 5 * 60_000;

/* First chase after an hour, then daily. A yard desk that gets pinged every
   ten minutes stops reading the pings. */
const FIRST_CHASE_MS = 60 * 60_000;
const REPEAT_CHASE_MS = 24 * 60 * 60_000;
const MAX_CHASES = 4;

export type RequestSweepResult = {
  requeued: number;
  unstuck: number;
  announced: number;
  escalated: number;
};

export async function sweepRequests(db: Database): Promise<RequestSweepResult> {
  const [requeued, unstuck] = await Promise.all([requeueFailed(db), unstickProcessing(db)]);
  const announced = await announceNewRequests(db);
  const escalated = await escalateAgingRequests(db);
  return { requeued, unstuck, announced, escalated };
}

/*
  Messages the parser could not be reached for.

  `pending_manual` is deliberately excluded: that status means the parser DID
  answer and could not match a tool, which is a judgement for the desk, not
  something a retry will change.
*/
async function requeueFailed(db: Database): Promise<number> {
  const rows = await db
    .update(schema.message)
    .set({
      processingStatus: "queued",
      attempts: sql`${schema.message.attempts} + 1`,
      /* Clear the old failure, or a message that goes on to parse cleanly
         still shows the desk the error that no longer applies. */
      errorNote: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.message.processingStatus, "error"),
        lt(schema.message.attempts, MAX_PARSE_ATTEMPTS),
      ),
    )
    .returning({ id: schema.message.id });

  if (rows.length) log.info("[request-worker] requeued failed messages", { count: rows.length });
  return rows.length;
}

/* A worker that died between claiming a message and finishing it leaves the row
   `processing` with nothing working on it. */
async function unstickProcessing(db: Database): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_MS);
  const rows = await db
    .update(schema.message)
    .set({
      processingStatus: "queued",
      attempts: sql`${schema.message.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.message.processingStatus, "processing"),
        lt(schema.message.updatedAt, cutoff),
        lt(schema.message.attempts, MAX_PARSE_ATTEMPTS),
      ),
    )
    .returning({ id: schema.message.id });

  if (rows.length) log.info("[request-worker] unstuck stalled messages", { count: rows.length });
  return rows.length;
}

/* Everyone who can actually decide a request, per tenant. Requests are
   deliberately unassigned when raised — the desk claims them — so the
   notification goes to all of them rather than picking one arbitrarily. */
async function deskFor(db: Database, tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.employee.id })
    .from(schema.employee)
    .where(
      and(
        eq(schema.employee.tenantId, tenantId),
        eq(schema.employee.employmentStatus, "active"),
        inArray(schema.employee.role, ["equipment_admin", "warehouse"]),
      ),
    );
  return rows.map((r) => r.id);
}

/* Pending requests nobody has been told about yet. */
async function announceNewRequests(db: Database): Promise<number> {
  const fresh = await db
    .select({
      id: schema.task.id,
      tenantId: schema.task.tenantId,
      title: schema.task.title,
      department: schema.task.department,
      actionType: schema.task.actionType,
      priority: schema.task.priority,
    })
    .from(schema.task)
    .where(
      and(
        eq(schema.task.status, "pending"),
        eq(schema.task.escalationCount, 0),
        isNull(schema.task.lastEscalatedAt),
        sql`${schema.task.actionType} is not null`,
      ),
    )
    .limit(50);

  let created = 0;
  for (const t of fresh) {
    const desk = await deskFor(db, t.tenantId);
    for (const employeeId of desk) {
      await createNotification(db, {
        tenantId: t.tenantId,
        recipientEmployeeId: employeeId,
        type: "request_pending",
        refType: "task",
        refId: t.id,
        title: t.title,
        body: `Waiting on ${t.department ?? "the equipment desk"}. Approve or decline it from the Inbox.`,
      });
      created++;
    }
    /* Marked as chased once even when there is no desk to tell, so an empty
       tenant does not re-announce the same request every sweep. */
    await db
      .update(schema.task)
      .set({ escalationCount: 1, lastEscalatedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.task.id, t.id));
  }

  if (created) log.info("[request-worker] announced new requests", { count: created });
  return created;
}

/*
  Requests still sitting there.

  A `lost` report that nobody acts on for a week is how a tool quietly becomes
  somebody's, so these get louder rather than being raised once and forgotten.
*/
async function escalateAgingRequests(db: Database): Promise<number> {
  const now = Date.now();
  const firstDue = new Date(now - FIRST_CHASE_MS);
  const repeatDue = new Date(now - REPEAT_CHASE_MS);

  const stale = await db
    .select({
      id: schema.task.id,
      tenantId: schema.task.tenantId,
      title: schema.task.title,
      department: schema.task.department,
      priority: schema.task.priority,
      escalationCount: schema.task.escalationCount,
      createdAt: schema.task.createdAt,
    })
    .from(schema.task)
    .where(
      and(
        eq(schema.task.status, "pending"),
        sql`${schema.task.actionType} is not null`,
        lt(schema.task.escalationCount, MAX_CHASES),
        or(
          and(eq(schema.task.escalationCount, 1), lt(schema.task.lastEscalatedAt, firstDue)),
          and(sql`${schema.task.escalationCount} > 1`, lt(schema.task.lastEscalatedAt, repeatDue)),
        ),
      ),
    )
    .limit(50);

  let created = 0;
  for (const t of stale) {
    const desk = await deskFor(db, t.tenantId);
    const waitingDays = Math.max(1, Math.round((now - new Date(t.createdAt).getTime()) / 86_400_000));
    for (const employeeId of desk) {
      await createNotification(db, {
        tenantId: t.tenantId,
        recipientEmployeeId: employeeId,
        type: "request_overdue",
        refType: "task",
        refId: t.id,
        title: `Still waiting: ${t.title}`,
        body: `Raised ${waitingDays} day${waitingDays === 1 ? "" : "s"} ago and nobody has decided it yet.`,
      });
      created++;
    }
    await db
      .update(schema.task)
      .set({
        escalationCount: t.escalationCount + 1,
        lastEscalatedAt: new Date(),
        /* A request that has been chased twice and is still sitting there is
           not a medium-priority item any more. */
        priority: t.escalationCount >= 2 ? "high" : t.priority,
        updatedAt: new Date(),
      })
      .where(eq(schema.task.id, t.id));
  }

  if (created) log.info("[request-worker] escalated aging requests", { count: created });
  return created;
}
