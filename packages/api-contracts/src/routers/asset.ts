import { alias } from "drizzle-orm/pg-core";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { logEvent } from "../audit.js";

export const assetRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          status: z.string().optional(),
          projectId: z.string().uuid().optional(),
          custodianId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const conditions = [eq(schema.asset.tenantId, tid)];
      if (input?.status && input.status !== "all") conditions.push(eq(schema.asset.currentStatus, input.status));
      if (input?.projectId) conditions.push(eq(schema.asset.currentProjectId, input.projectId));
      if (input?.custodianId) conditions.push(eq(schema.asset.currentCustodianId, input.custodianId));
      if (input?.search) {
        const q = `%${input.search}%`;
        conditions.push(
          or(
            ilike(schema.asset.tag, q),
            ilike(schema.asset.modelName, q),
            ilike(schema.asset.serialNumber, q),
          )!,
        );
      }
      const currentProject = alias(schema.project, "current_project");
      const owningProject = alias(schema.project, "owning_project");
      const rows = await ctx.db
        .select({
          id: schema.asset.id,
          tag: schema.asset.tag,
          modelName: schema.asset.modelName,
          categoryName: schema.asset.categoryName,
          serialNumber: schema.asset.serialNumber,
          isSerialized: schema.asset.isSerialized,
          quantity: schema.asset.quantity,
          status: schema.asset.currentStatus,
          acquisitionCost: schema.asset.acquisitionCost,
          acquisitionDate: schema.asset.acquisitionDate,
          warrantyExpiresOn: schema.asset.warrantyExpiresOn,
          condition: schema.asset.condition,
          custodianId: schema.asset.currentCustodianId,
          custodianName: schema.employee.name,
          custodianExternalId: schema.employee.externalId,
          currentProjectId: schema.asset.currentProjectId,
          currentProjectName: currentProject.name,
          locationId: schema.asset.currentLocationId,
          locationName: schema.location.name,
          owningProjectId: schema.asset.owningProjectId,
          owningProjectName: owningProject.name,
        })
        .from(schema.asset)
        .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
        .leftJoin(currentProject, eq(schema.asset.currentProjectId, currentProject.id))
        .leftJoin(schema.location, eq(schema.asset.currentLocationId, schema.location.id))
        .leftJoin(owningProject, eq(schema.asset.owningProjectId, owningProject.id))
        .where(and(...conditions));
      return rows;
    }),

  // Returns the same joined shape as `list` so the detail screen shows names,
  // not raw uuids. Both projections read from asset.current_* — never from a
  // hand-edited field.
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const currentProject = alias(schema.project, "current_project");
      const owningProject = alias(schema.project, "owning_project");
      const [row] = await ctx.db
        .select({
          id: schema.asset.id,
          tag: schema.asset.tag,
          modelName: schema.asset.modelName,
          categoryName: schema.asset.categoryName,
          serialNumber: schema.asset.serialNumber,
          isSerialized: schema.asset.isSerialized,
          quantity: schema.asset.quantity,
          status: schema.asset.currentStatus,
          acquisitionCost: schema.asset.acquisitionCost,
          acquisitionDate: schema.asset.acquisitionDate,
          warrantyExpiresOn: schema.asset.warrantyExpiresOn,
          condition: schema.asset.condition,
          custodianId: schema.asset.currentCustodianId,
          custodianName: schema.employee.name,
          custodianExternalId: schema.employee.externalId,
          currentProjectId: schema.asset.currentProjectId,
          currentProjectName: currentProject.name,
          locationId: schema.asset.currentLocationId,
          locationName: schema.location.name,
          owningProjectId: schema.asset.owningProjectId,
          owningProjectName: owningProject.name,
          createdAt: schema.asset.createdAt,
        })
        .from(schema.asset)
        .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
        .leftJoin(currentProject, eq(schema.asset.currentProjectId, currentProject.id))
        .leftJoin(schema.location, eq(schema.asset.currentLocationId, schema.location.id))
        .leftJoin(owningProject, eq(schema.asset.owningProjectId, owningProject.id))
        .where(and(eq(schema.asset.id, input.id), eq(schema.asset.tenantId, ctx.session.tenantId)));
      return row ?? null;
    }),

  create: requirePermission("asset.manage")
    .input(
      z.object({
        tag: z.string().min(1).max(60),
        modelName: z.string().min(1).max(200),
        categoryName: z.string().optional(),
        serialNumber: z.string().optional(),
        isSerialized: z.boolean().default(true),
        quantity: z.number().int().min(1).default(1),
        acquisitionCost: z.string().optional(),
        acquisitionDate: z.string().optional(),
        owningProjectId: z.string().uuid().optional(),
        warrantyExpiresOn: z.string().optional(),
        condition: z.string().default("good"),
        locationId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.asset)
        .values({
          tenantId: ctx.session.tenantId,
          createdBy: ctx.session.userId,
          currentStatus: "available",
          currentLocationId: input.locationId ?? null,
          ...input,
        })
        .returning();
      if (row) {
        await ctx.db.insert(schema.transaction).values({
          tenantId: ctx.session.tenantId,
          assetId: row.id,
          eventType: "tag",
          actorId: ctx.session.userId,
          toState: { status: "available", custodianId: null, projectId: null, locationId: input.locationId ?? null },
          refType: "manual",
          note: `Asset ${row.tag} registered`,
        });
        await logEvent(ctx, {
          category: "asset",
          action: "create",
          entityType: "asset",
          entityId: row.id,
          entityLabel: row.tag,
        });
      }
      return row;
    }),

  /*
    Correct the record, not the custody.

    Only the descriptive fields are editable: what the tool IS, what it cost,
    which project's capital bought it. Where it is and who has it are
    projections of the transaction log and must not be typed over — that is
    what Assign, Transfer and Return are for, and editing around them would
    put the register and its own audit trail into disagreement.

    `owningProjectId` is included with reluctance. It is meant to be immutable
    once set, but it is also the field most often wrong at import time and
    there is no other way to fix a mis-keyed one.
  */
  update: requirePermission("asset.manage")
    .input(
      z.object({
        id: z.string().uuid(),
        tag: z.string().min(1).max(60).optional(),
        modelName: z.string().min(1).max(200).optional(),
        categoryName: z.string().max(120).nullable().optional(),
        serialNumber: z.string().max(120).nullable().optional(),
        quantity: z.number().int().min(1).optional(),
        acquisitionCost: z.string().max(20).nullable().optional(),
        acquisitionDate: z.string().nullable().optional(),
        warrantyExpiresOn: z.string().nullable().optional(),
        condition: z.string().max(30).optional(),
        owningProjectId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const { id, ...changes } = input;

      const existing = await ctx.db.query.asset.findFirst({
        where: and(eq(schema.asset.id, id), eq(schema.asset.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such tool in this tenant" });

      /* A tag is how everyone refers to the tool out loud; two rows answering
         to the same one makes every conversation ambiguous. */
      if (changes.tag && changes.tag !== existing.tag) {
        const clash = await ctx.db.query.asset.findFirst({
          where: and(eq(schema.asset.tenantId, tid), eq(schema.asset.tag, changes.tag)),
        });
        if (clash) throw new TRPCError({ code: "CONFLICT", message: `${changes.tag} is already in the register` });
      }

      const patch = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      if (!Object.keys(patch).length) return existing;

      const [row] = await ctx.db
        .update(schema.asset)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(schema.asset.id, id), eq(schema.asset.tenantId, tid)))
        .returning();

      await logEvent(ctx, {
        category: "asset",
        action: "update",
        entityType: "asset",
        entityId: id,
        entityLabel: row?.tag ?? existing.tag,
        details: { changed: Object.keys(patch) },
      });
      return row;
    }),

  /*
    Remove a tool from the register.

    A tool with history is never deleted. Its transactions ARE the audit trail,
    and dropping the row would take them with it (`on delete cascade`) — so a
    tool that was assigned, lost and found would leave no trace it ever
    existed. Those get `disposed` instead, which keeps the history and takes
    them out of every active view.

    Hard delete stays available for the case it is actually for: a row typed in
    wrong five minutes ago that has never been used.
  */
  delete: requirePermission("asset.manage")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.asset.findFirst({
        where: and(eq(schema.asset.id, input.id), eq(schema.asset.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such tool in this tenant" });

      if (existing.currentCustodianId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Someone is holding this tool. Return it first.",
        });
      }

      /* The opening `tag` event is written by every creation path, so one
         transaction means "never used" and more means real history. */
      const events = await ctx.db
        .select({ id: schema.transaction.id })
        .from(schema.transaction)
        .where(eq(schema.transaction.assetId, input.id))
        .limit(2);

      if (events.length > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This tool has history. Deleting it would delete its audit trail — mark it disposed instead.",
        });
      }

      await ctx.db
        .delete(schema.asset)
        .where(and(eq(schema.asset.id, input.id), eq(schema.asset.tenantId, tid)));

      await logEvent(ctx, {
        category: "asset",
        action: "delete",
        entityType: "asset",
        entityId: input.id,
        entityLabel: existing.tag,
      });
      return { ok: true };
    }),

  setStatus: requirePermission("asset.manage")
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.string(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(schema.asset)
        .set({ currentStatus: input.status, updatedAt: new Date() })
        .where(and(eq(schema.asset.id, input.id), eq(schema.asset.tenantId, ctx.session.tenantId)))
        .returning();
      if (row) {
        await ctx.db.insert(schema.transaction).values({
          tenantId: ctx.session.tenantId,
          assetId: row.id,
          eventType: "status_change",
          actorId: ctx.session.userId,
          toState: { status: input.status },
          refType: "manual",
          note: input.note ?? `Status → ${input.status}`,
        });
      }
      return row;
    }),

  rebuild: requirePermission("asset.manage").mutation(async ({ ctx }) => {
    // Rebuild all assets.current_* from the transaction log (rebuild guarantee).
    const tid = ctx.session.tenantId;
    const events = await ctx.db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.tenantId, tid))
      .orderBy(sql`${schema.transaction.occurredAt} ASC, ${schema.transaction.id} ASC`);
    const byAsset = new Map<string, (typeof events)[number][]>();
    for (const e of events) {
      const list = byAsset.get(e.assetId);
      if (list) list.push(e);
      else byAsset.set(e.assetId, [e]);
    }
    let updated = 0;
    for (const [assetId, list] of byAsset) {
      let latest: (typeof events)[number] | null = null;
      for (const e of list) if (e.toState) latest = e;
      if (latest?.toState) {
        const s = latest.toState as {
          status?: string;
          custodianId?: string | null;
          projectId?: string | null;
          locationId?: string | null;
        };
        await ctx.db
          .update(schema.asset)
          .set({
            currentStatus: s.status ?? "available",
            currentCustodianId: s.custodianId ?? null,
            currentProjectId: s.projectId ?? null,
            currentLocationId: s.locationId ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tid)));
        updated++;
      }
    }
    return { assetsRebuilt: updated, totalEvents: events.length };
  }),
});
