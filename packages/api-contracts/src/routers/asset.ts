import { alias } from "drizzle-orm/pg-core";
import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, requirePermission, router, type Context } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { logEvent } from "../audit.js";
import { COST_TARGETS, formatAssetModel } from "@stinventory/types";
import { foldAssetState, hasSnapshotEvidence, reconcileProjections, type EventEnvelope } from "@stinventory/domain";

/* A tool needs to be describable, not catalogued. A brand with no catalogue
   number is completely ordinary ("Skill Saw" is a description, not a brand), so
   the rule is at least one of make or description — never a model number. */
const assetRefine = (v: {
  costTarget?: string;
  owningDepartmentId?: string | null;
  owningProjectId?: string | null;
}, ctx: z.RefinementCtx) => {
  if (v.costTarget === "department") {
    if (!v.owningDepartmentId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["owningDepartmentId"], message: "Say which department pays for this tool." });
    }
    if (v.owningProjectId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["owningProjectId"], message: "A tool charged to a department cannot also name a project." });
    }
  } else if (v.costTarget === "project" && v.owningDepartmentId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["owningDepartmentId"], message: "A tool charged to a project cannot also name a department." });
  }
};

export const assetRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          status: z.string().optional(),
          /*
            A project id, or the literal "none" for tools booked to no project
            at all.

            A tool without a project is a normal state, not a broken one — it is
            in the yard, or a foreman is holding it between jobs. But "no
            project" is not expressible as a uuid, so the only question that
            could be asked here was "which tools are on project X". The tools on
            no project were visible one at a time in the register and impossible
            to see as a group, which is also the group with a billing question
            attached to it.
          */
          projectId: z.union([z.string().uuid(), z.literal("none")]).optional(),
          custodianId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const conditions = [eq(schema.asset.tenantId, tid)];
      if (input?.status && input.status !== "all") conditions.push(eq(schema.asset.currentStatus, input.status));
      if (input?.projectId === "none") conditions.push(isNull(schema.asset.currentProjectId));
      else if (input?.projectId) conditions.push(eq(schema.asset.currentProjectId, input.projectId));
      if (input?.custodianId) conditions.push(eq(schema.asset.currentCustodianId, input.custodianId));
      if (input?.search) {
        const q = `%${input.search}%`;
        conditions.push(
          or(
            ilike(schema.asset.tag, q),
            ilike(schema.asset.make, q),
            ilike(schema.asset.modelNumber, q),
            ilike(schema.asset.description, q),
            ilike(schema.asset.serialNumber, q),
          )!,
        );
      }
      const currentProject = alias(schema.project, "current_project");
      const owningProject = alias(schema.project, "owning_project");
      const owningDepartment = alias(schema.department, "owning_department");
      const rows = await ctx.db
        .select({
          id: schema.asset.id,
          assetNumber: schema.asset.assetNumber,
          tag: schema.asset.tag,
          make: schema.asset.make,
          modelNumber: schema.asset.modelNumber,
          description: schema.asset.description,
          otherRef: schema.asset.otherRef,
          categoryName: schema.asset.categoryName,
          serialNumber: schema.asset.serialNumber,
          isSerialized: schema.asset.isSerialized,
          quantity: schema.asset.quantity,
          status: schema.asset.currentStatus,
          acquisitionCost: schema.asset.acquisitionCost,
          acquisitionDate: schema.asset.acquisitionDate,
          warrantyExpiresOn: schema.asset.warrantyExpiresOn,
          photoKey: schema.asset.photoKey,
          condition: schema.asset.condition,
          custodianId: schema.asset.currentCustodianId,
          custodianName: schema.employee.name,
          custodianExternalId: schema.employee.externalId,
          currentProjectId: schema.asset.currentProjectId,
          currentProjectName: currentProject.name,
          currentProjectExternalId: currentProject.externalId,
          locationId: schema.asset.currentLocationId,
          locationName: schema.location.name,
          /* A vehicle is a `location` of type vehicle — but the register groups
             tools by truck vs trailer, which only the vehicle row knows. */
          locationType: schema.location.type,
          vehicleType: schema.vehicle.vehicleType,
          owningProjectId: schema.asset.owningProjectId,
          owningProjectName: owningProject.name,
          costTarget: schema.asset.costTarget,
          owningDepartmentId: schema.asset.owningDepartmentId,
          owningDepartmentName: owningDepartment.name,
        })
        .from(schema.asset)
        .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
        .leftJoin(currentProject, eq(schema.asset.currentProjectId, currentProject.id))
        .leftJoin(schema.location, eq(schema.asset.currentLocationId, schema.location.id))
        .leftJoin(schema.vehicle, eq(schema.vehicle.locationId, schema.location.id))
        .leftJoin(owningProject, eq(schema.asset.owningProjectId, owningProject.id))
        .leftJoin(owningDepartment, eq(schema.asset.owningDepartmentId, owningDepartment.id))
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
      const owningDepartment = alias(schema.department, "owning_department");
      const [row] = await ctx.db
        .select({
          id: schema.asset.id,
          assetNumber: schema.asset.assetNumber,
          tag: schema.asset.tag,
          make: schema.asset.make,
          modelNumber: schema.asset.modelNumber,
          description: schema.asset.description,
          categoryName: schema.asset.categoryName,
          serialNumber: schema.asset.serialNumber,
          isSerialized: schema.asset.isSerialized,
          quantity: schema.asset.quantity,
          status: schema.asset.currentStatus,
          acquisitionCost: schema.asset.acquisitionCost,
          acquisitionDate: schema.asset.acquisitionDate,
          warrantyExpiresOn: schema.asset.warrantyExpiresOn,
          photoKey: schema.asset.photoKey,
          condition: schema.asset.condition,
          custodianId: schema.asset.currentCustodianId,
          custodianName: schema.employee.name,
          custodianExternalId: schema.employee.externalId,
          currentProjectId: schema.asset.currentProjectId,
          currentProjectName: currentProject.name,
          currentProjectExternalId: currentProject.externalId,
          locationId: schema.asset.currentLocationId,
          locationName: schema.location.name,
          owningProjectId: schema.asset.owningProjectId,
          owningProjectName: owningProject.name,
          costTarget: schema.asset.costTarget,
          owningDepartmentId: schema.asset.owningDepartmentId,
          owningDepartmentName: owningDepartment.name,
          createdAt: schema.asset.createdAt,
        })
        .from(schema.asset)
        .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
        .leftJoin(currentProject, eq(schema.asset.currentProjectId, currentProject.id))
        .leftJoin(schema.location, eq(schema.asset.currentLocationId, schema.location.id))
        .leftJoin(owningProject, eq(schema.asset.owningProjectId, owningProject.id))
        .leftJoin(owningDepartment, eq(schema.asset.owningDepartmentId, owningDepartment.id))
        .where(and(eq(schema.asset.id, input.id), eq(schema.asset.tenantId, ctx.session.tenantId)));
      return row ?? null;
    }),

  create: requirePermission("asset.manage")
    .input(
      z.object({
        tag: z.string().max(60).optional(),
        make: z.string().max(80).optional(),
        modelNumber: z.string().max(80).optional(),
        description: z.string().max(200).optional(),
        categoryName: z.string().optional(),
        serialNumber: z.string().optional(),
        isSerialized: z.boolean().default(true),
        quantity: z.number().int().min(1).default(1),
        acquisitionCost: z.string().optional(),
        acquisitionDate: z.string().optional(),
        owningProjectId: z.string().uuid().optional(),
        costTarget: z.enum(COST_TARGETS).default("project"),
        owningDepartmentId: z.string().uuid().nullable().optional(),
        warrantyExpiresOn: z.string().optional(),
        condition: z.string().default("good"),
        locationId: z.string().uuid().optional(),
      }).superRefine((v, ctx) => {
        if (!v.make && !v.description) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["description"], message: "A tool needs a make or a description." });
        }
        assetRefine(v, ctx);
      }),
    )
    .mutation(async ({ ctx, input }) => {
      /* A tag is a label somebody has physically put on the tool, so a new row
         may arrive without one. What it is called in the ledger is the id; the
         display name is whatever of make/model/description was given. */
      const label = formatAssetModel(input) || "Untagged tool";
      /* One transaction for the row and its opening `tag` event (STI-115).
         These were two bare awaits; a failure between them left an asset with
         a projection but zero ledger rows — and because the ledger is
         append-only (STI-104), the missing opening snapshot could never be
         written retroactively, so STI-110's sweep reported the asset as
         no_evidence forever. Same shape as the importer's insertOne. */
      const row = await ctx.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.asset)
          .values({
            tenantId: ctx.session.tenantId,
            createdBy: ctx.session.userId,
            currentStatus: "available",
            currentLocationId: input.locationId ?? null,
            ...input,
          })
          .returning();
        if (created) {
          await tx.insert(schema.transaction).values({
            tenantId: ctx.session.tenantId,
            assetId: created.id,
            eventType: "tag",
            actorId: ctx.session.userId,
            toState: { status: "available", custodianId: null, projectId: null, locationId: input.locationId ?? null },
            refType: "manual",
            note: `Asset ${label} registered`,
          });
        }
        return created;
      });
      if (row) {
        /* Deliberately OUTSIDE the transaction. The ledger event above is the
           evidence; event_log is best-effort observability and logEvent already
           swallows its own failures, so an audit hiccup must never roll back a
           legitimate create. Running after commit also means it can never
           describe an asset that does not exist — and the custody rule forbids
           awaiting logEvent inside db.transaction anyway (it pins a pool
           connection). The importer makes the same call. */
        await logEvent(ctx, {
          category: "asset",
          action: "create",
          entityType: "asset",
          entityId: row.id,
          entityLabel: row.tag ?? label,
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
        tag: z.string().max(60).optional(),
        make: z.string().max(80).nullable().optional(),
        modelNumber: z.string().max(80).nullable().optional(),
        description: z.string().max(200).nullable().optional(),
        categoryName: z.string().max(120).nullable().optional(),
        serialNumber: z.string().max(120).nullable().optional(),
        quantity: z.number().int().min(1).optional(),
        acquisitionCost: z.string().max(20).nullable().optional(),
        acquisitionDate: z.string().nullable().optional(),
        warrantyExpiresOn: z.string().nullable().optional(),
        condition: z.string().max(30).optional(),
        owningProjectId: z.string().uuid().nullable().optional(),
        costTarget: z.enum(COST_TARGETS).optional(),
        owningDepartmentId: z.string().uuid().nullable().optional(),
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

      /* `costTarget` is optional on update, so the refine runs against the
         merged shape — clearing a project while switching to department is two
         calls that each look fine but together must fail. */
      if (changes.costTarget || changes.owningDepartmentId !== undefined) {
        const merged = {
          costTarget: changes.costTarget ?? existing.costTarget,
          owningDepartmentId:
            changes.owningDepartmentId !== undefined ? changes.owningDepartmentId : existing.owningDepartmentId,
          owningProjectId:
            changes.owningProjectId !== undefined ? changes.owningProjectId : existing.owningProjectId,
        };
        const parsed = z
          .object({
            costTarget: z.enum(COST_TARGETS),
            owningDepartmentId: z.string().uuid().nullable(),
            owningProjectId: z.string().uuid().nullable(),
          })
          .superRefine(assetRefine)
          .safeParse(merged);
        if (!parsed.success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid cost target" });
        }
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
        entityLabel: row?.tag ?? existing.tag ?? formatAssetModel(existing),
        details: { changed: Object.keys(patch) },
      });
      return row;
    }),

  /*
    Remove a tool from the register — which is to say: refuse to.

    A tool's transactions ARE the audit trail, and dropping the row would take
    them with it (`on delete cascade`). This procedure used to allow a hard
    delete for a row "typed in wrong five minutes ago" — exactly one ledger
    event, the opening `tag` that every creation path writes (see `create`).

    Since STI-104 that path is unreachable by construction, not merely risky:
    the ledger's append-only triggers (drizzle/0014_append_only_ledger.sql)
    block the cascade DELETE of even that single event with SQLSTATE 0A000, so
    every asset — all of which carry the `tag` event from birth — is
    undeletable. Attempting it surfaced as a raw INTERNAL_SERVER_ERROR.
    Deliberate product change: refuse cleanly with the disposal guidance
    instead. Do NOT re-enable hard delete by disabling or excepting the
    trigger — a cascade hole in the ledger defeats the control.
  */
  delete: requirePermission("asset.manage")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.asset.findFirst({
        where: and(eq(schema.asset.id, input.id), eq(schema.asset.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such tool in this tenant" });

      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Tools are never deleted: the ledger is append-only and its events are the audit trail. Mark it disposed instead — that keeps the history and removes it from every active view.",
      });
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
      /* Read before the write, so the ledger can record both sides. */
      const before = await ctx.db.query.asset.findFirst({
        where: and(eq(schema.asset.id, input.id), eq(schema.asset.tenantId, ctx.session.tenantId)),
      });

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
          fromState: before
            ? {
                status: before.currentStatus,
                custodianId: before.currentCustodianId,
                projectId: before.currentProjectId,
                locationId: before.currentLocationId,
              }
            : null,
          /*
            A complete snapshot. This wrote `{ status }` alone, and the fold is
            last-snapshot-wins — so replaying the ledger past a status change
            blanked the holder, the project and the location. Only the status
            was changing; everything else has to be restated to survive.
          */
          toState: {
            status: input.status,
            custodianId: row.currentCustodianId,
            projectId: row.currentProjectId,
            locationId: row.currentLocationId,
          },
          refType: "manual",
          note: input.note ?? `Status → ${input.status}`,
        });
      }
      return row;
    }),

  /*
    The reconciliation check (STI-106): compares the register against a replay of
    the ledger and REPORTS — it writes nothing. `rebuild` below repairs, and in
    doing so destroys the only signal a broken writer emits: the register quietly
    becomes right again and nobody learns which code path corrupted it. Keeping
    the two as separate explicit actions is the point, not an inconvenience.
  */
  verifyProjection: requirePermission("asset.manage").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const projected = (
      await ctx.db
        .select({
          assetId: schema.asset.id,
          assetNumber: schema.asset.assetNumber,
          tag: schema.asset.tag,
          status: schema.asset.currentStatus,
          custodianId: schema.asset.currentCustodianId,
          projectId: schema.asset.currentProjectId,
          locationId: schema.asset.currentLocationId,
        })
        .from(schema.asset)
        .where(eq(schema.asset.tenantId, tid))
    ).map((a) => ({ ...a, label: a.tag ? `#${a.assetNumber} ${a.tag}` : `#${a.assetNumber}` }));
    const events = await tenantLedger(ctx.db, tid);
    const divergences = reconcileProjections(projected, events);
    return { assetsChecked: projected.length, totalEvents: events.length, divergences };
  }),

  rebuild: requirePermission("asset.manage").mutation(async ({ ctx }) => {
    // Rebuild all assets.current_* from the transaction log (rebuild guarantee).
    const tid = ctx.session.tenantId;
    const events = await tenantLedger(ctx.db, tid);
    const byAsset = new Map<string, EventEnvelope[]>();
    for (const e of events) {
      const list = byAsset.get(e.assetId);
      if (list) list.push(e);
      else byAsset.set(e.assetId, [e]);
    }
    let updated = 0;
    let skippedNoEvidence = 0;
    /* Assets with NO ledger row at all never appear in `byAsset`, so the loop
       below cannot see them and the skip count silently omitted exactly the
       shape it exists to report. STI-101's backfill emptied the "has events but
       none carry a snapshot" set by construction, so a zero-event asset is the
       only no-evidence shape actually reachable today — a REST-created asset, or
       an `asset.create` that failed between its two writes (STI-115/STI-116).
       Counted here rather than in the loop, because there is nothing to loop
       over. Found by QA on 2026-08-18: rebuild reported
       `assetsSkippedNoEvidence: 0` with a no-evidence divergence open. */
    const assetsWithNoEvents = await ctx.db
      .select({ id: schema.asset.id })
      .from(schema.asset)
      .where(eq(schema.asset.tenantId, tid));
    skippedNoEvidence += assetsWithNoEvents.filter((a) => !byAsset.has(a.id)).length;
    for (const [assetId, list] of byAsset) {
      /* An asset whose ledger carries no complete snapshot is skipped, not
         blanked: the fold's INITIAL_STATE answer is indistinguishable from "no
         evidence", and overwriting a live register row on no evidence is how a
         repair becomes the corruption. verifyProjection above deliberately does
         NOT share this tolerance — there an empty fold is a divergence, of kind
         `no_evidence` (STI-110): the same `hasSnapshotEvidence` predicate
         drives both, so what rebuild refuses to touch is exactly what the
         report names unrepairable. The skip count is returned because QA once
         watched `{assetsRebuilt: 1}` come back with two divergences open and
         had no way to tell the second was skipped rather than missed. */
      if (!hasSnapshotEvidence(list)) {
        skippedNoEvidence++;
        continue;
      }
      /* The fold is the domain function, not a re-implementation. An inline
         copy used to live here, and it merely happened to agree with the tested
         `foldAssetState` — STI-106 made the production path and the tested path
         the same code. */
      const s = foldAssetState(list);
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
    return { assetsRebuilt: updated, assetsSkippedNoEvidence: skippedNoEvidence, totalEvents: events.length };
  }),
});

/* The whole tenant ledger, typed as the envelopes the domain fold takes. The
   jsonb columns come back `unknown`; the cast is the one place that unknown is
   pinned to the snapshot shape both `foldAssetState` and `reconcileProjections`
   consume. No ORDER BY — the fold sorts for itself (occurredAt, then id). */
async function tenantLedger(db: Context["db"], tid: string): Promise<EventEnvelope[]> {
  const rows = await db
    .select()
    .from(schema.transaction)
    .where(eq(schema.transaction.tenantId, tid));
  return rows as unknown as EventEnvelope[];
}
