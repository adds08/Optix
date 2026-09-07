import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant, user } from "./identity";

/*
  One row per press of "Sync from BambooHR".

  WHY A TABLE AND NOT JUST AN AWAIT. The sync fetches a cursor-paginated roster
  over the network and then writes people, so it is far too slow to hold a tRPC
  request open for, and holding one would also pin a postgres.js pool
  connection (`max: 10`) for its duration. The button therefore inserts a row
  and returns immediately; a worker picks it up and the client polls this table.
  That is the same shape `messaging.send` already uses for chat, and copying it
  was deliberate — a second mechanism for "started now, finished later" is a
  second thing to reason about.

  There is no general job queue in this codebase (the background layer is a
  handful of `setInterval` callbacks in `apps/api/src/index.ts`) and this does
  not try to become one. It is a sync-run log that happens to be claimable.
  If a third kind of background job ever appears, THAT is the moment to
  generalise — not now, on one caller.

  Runs are kept after they finish. The history is the point: "what did the last
  sync change" is the first question anybody asks after pressing it, and a row
  that deletes itself on success can only ever answer that for a failure.
*/
export const syncRun = pgTable(
  "tbl_ops_sync_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    /* Which far system. `bamboohr` is the only value today; the column exists
       because this repo's own comments already name three (BambooHR, Mark 85,
       FoundationSoft) and a second source must not need a second table.
       Plain text, like every other vocabulary here — the enum lives in
       `packages/types` and Postgres will not enforce it. */
    source: text("source").notNull(),
    /*
      `preview` writes NOTHING and only reports what it would do; `apply`
      writes. Two modes on one row rather than two tables, because the preview
      is the same fetch and the same diff as the apply — the only difference is
      whether the last step runs. Storing them together is also what lets the UI
      show "you previewed this at 09:00 and applied it at 09:02".
    */
    mode: text("mode").notNull().default("preview"), // preview | apply
    /* queued | running | done | failed. `queued` is what the button writes and
       what the worker claims. */
    status: text("status").notNull().default("queued"),
    /* Who pressed it. `set null` so deleting an account does not delete the
       audit trail of what it changed — the run is a record of an event, and the
       event still happened. */
    requestedByUserId: uuid("requested_by_user_id").references(() => user.id, { onDelete: "set null" }),

    /*
      The counts, which are the whole visible output of a run.

      `refused` and `skipped` are NOT the same thing and collapsing them would
      hide the only category that needs a human: a refused record could not be
      adapted at all (no `employeeId`), whereas a skipped one was understood
      perfectly and had nothing to change.

      `flagged` counts people BambooHR reports as inactive. Settled with the
      user 2026-09-07: a sync never deactivates anybody. It raises the flag and
      an admin decides, because terminating an employee reaches tool custody and
      the clearance queue.
    */
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    refusedCount: integer("refused_count").notNull().default(0),
    flaggedCount: integer("flagged_count").notNull().default(0),

    /*
      The per-person detail: what would change, or did. Read by the preview
      screen so somebody can see "Alejandro Capuchino: email added, code
      URB-001 -> 10428 (needs confirming)" instead of a bare number.

      jsonb rather than a child table, and this is a deliberate line: these rows
      are a REPORT, never a source of truth. Nothing joins them, nothing
      queries inside them, and they are rewritten wholesale by the run that
      produced them. A child table would invite both.
    */
    detail: jsonb("detail"),

    /* Bounded retries, matching `notifications.ts` (MAX_DELIVERY_ATTEMPTS) and
       `tbl_ops_message.attempts`. A sync that fails on a bad credential must
       not retry forever against the client's production HR system. */
    attempts: integer("attempts").notNull().default(0),
    /* Truncated at the write site, as `tbl_ops_message.error_note` is — a
       provider stack trace in a column nobody caps is how a row gets too big
       to read. */
    errorNote: text("error_note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index("sync_run_tenant_idx").on(t.tenantId),
    /* The worker's claim scan and the UI's "latest run" both read by status and
       recency, so they share one index. */
    statusIdx: index("sync_run_status_idx").on(t.status, t.createdAt),
    /*
      ONE unfinished run per tenant per source, enforced by the database rather
      than by a check in the router.

      Two concurrent syncs of the same roster would interleave their writes and
      race on the first bind of a person to a BambooHR id — and the second one
      to arrive would be doing work the first had already done. A partial unique
      index is the same tool `assignment_one_active_uq` uses for the same class
      of problem: the router's own guard can be raced, this cannot. A caller
      that loses the race gets a constraint violation, which is a much better
      failure than a duplicate run nobody notices.
    */
    oneOpenUq: uniqueIndex("sync_run_one_open_uq")
      .on(t.tenantId, t.source)
      .where(sql`status in ('queued', 'running')`),
  }),
);
