import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
import { requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

/*
  "Sync from BambooHR" — the button's server side.

  Three procedures and nothing else: START a run, read the LATEST one, and list
  recent HISTORY. The work itself happens in `apps/api/src/bamboo-sync.ts`,
  picked up by a worker, because a paginated network fetch plus a few hundred
  writes is far too slow to hold a tRPC request open for — and holding one
  would pin a postgres.js pool connection (`max: 10`) for its duration.

  So `start` inserts a queued row and returns immediately; the client polls
  `latest`. Same shape as `messaging.send`, deliberately.

  NOTHING HERE CALLS BAMBOOHR. This file only writes rows in our own database.
*/

/* `employee.manage`, not `config.manage`. The honest gate is the one that
   matches the effect: a sync creates and edits PEOPLE, so it needs the
   permission that means "add and edit people". Gating it on config.manage
   would let somebody who may not edit one person edit eighty-three at once. */
const SYNC_SOURCES = ["bamboohr"] as const;

export const syncRouter = router({
  /*
    Queue a run.

    `mode: "preview"` writes nothing and only reports what it would do;
    `"apply"` writes. Preview is the DEFAULT because the destructive option
    should be the one you have to ask for by name.
  */
  start: requirePermission("employee.manage")
    .input(
      z.object({
        source: z.enum(SYNC_SOURCES).default("bamboohr"),
        mode: z.enum(["preview", "apply"]).default("preview"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;

      /*
        One open run per tenant per source. There is a partial unique index
        behind this (`sync_run_one_open_uq`) and it is the real guard — this
        check exists to turn its constraint violation into a sentence somebody
        can read, not to replace it. Two concurrent syncs would interleave
        writes and race the first bind of a person to a BambooHR id.
      */
      const open = await ctx.db
        .select({ id: schema.syncRun.id, status: schema.syncRun.status })
        .from(schema.syncRun)
        .where(
          and(
            eq(schema.syncRun.tenantId, tid),
            eq(schema.syncRun.source, input.source),
            /* `inArray` would read better but two equality checks keep this
               greppable against the index's own WHERE clause. */
            eq(schema.syncRun.status, "queued"),
          ),
        )
        .limit(1);
      if (open[0]) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A sync is already queued. Wait for it to finish before starting another.",
        });
      }
      const running = await ctx.db
        .select({ id: schema.syncRun.id })
        .from(schema.syncRun)
        .where(
          and(
            eq(schema.syncRun.tenantId, tid),
            eq(schema.syncRun.source, input.source),
            eq(schema.syncRun.status, "running"),
          ),
        )
        .limit(1);
      if (running[0]) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A sync is already running. Wait for it to finish before starting another.",
        });
      }

      const [row] = await ctx.db
        .insert(schema.syncRun)
        .values({
          tenantId: tid,
          source: input.source,
          mode: input.mode,
          status: "queued",
          requestedByUserId: ctx.session.userId,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not queue the sync" });

      /* Outside any transaction — `logEvent` is one of the things the custody
         rules name as never belonging inside one. */
      await logEvent(ctx, {
        category: "system",
        action: "sync.start",
        entityType: "sync_run",
        entityId: row.id,
        entityLabel: `${input.source} (${input.mode})`,
        details: { source: input.source, mode: input.mode },
      });

      return row;
    }),

  /*
    The most recent run, whatever its state. What the button polls.

    Returns null rather than throwing when a tenant has never synced — "you
    have not done this yet" is a normal answer and a screen should render it,
    not an error boundary.
  */
  latest: requirePermission("employee.manage")
    .input(z.object({ source: z.enum(SYNC_SOURCES).default("bamboohr") }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(schema.syncRun)
        .where(
          and(
            eq(schema.syncRun.tenantId, ctx.session.tenantId),
            eq(schema.syncRun.source, input?.source ?? "bamboohr"),
          ),
        )
        .orderBy(desc(schema.syncRun.createdAt))
        .limit(1);
      return rows[0] ?? null;
    }),

  /*
    Recent runs, newest first, WITHOUT their `detail` blob.

    The blob is capped at 500 people and is the single biggest thing in the
    table, so a history list that selected it would ship megabytes to render a
    handful of dates and counts. `latest` carries it; this does not.
  */
  history: requirePermission("employee.manage")
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: schema.syncRun.id,
          source: schema.syncRun.source,
          mode: schema.syncRun.mode,
          status: schema.syncRun.status,
          createdCount: schema.syncRun.createdCount,
          updatedCount: schema.syncRun.updatedCount,
          skippedCount: schema.syncRun.skippedCount,
          refusedCount: schema.syncRun.refusedCount,
          flaggedCount: schema.syncRun.flaggedCount,
          errorNote: schema.syncRun.errorNote,
          createdAt: schema.syncRun.createdAt,
          finishedAt: schema.syncRun.finishedAt,
        })
        .from(schema.syncRun)
        .where(eq(schema.syncRun.tenantId, ctx.session.tenantId))
        .orderBy(desc(schema.syncRun.createdAt))
        .limit(input?.limit ?? 10);
    }),
});
