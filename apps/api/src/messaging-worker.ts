import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import type { ServerEnv } from "@stinventory/env";
import { createLogger } from "@stinventory/logger";
import { parseIntent } from "./engine-client.js";
import type { EngineParseResponse } from "./engine-client.js";
import {
  applyChatAction,
  AUTO_SAFE_INTENTS,
  departmentForAction,
  llmConfigFor,
  type ChatAction,
} from "@stinventory/api-contracts";
import { NEW_TOOL_INTENTS } from "@stinventory/intent";
import {
  formatAssetModel,
  slotsFromMentions,
  type ChatMention,
  type MentionSlots,
  type Permission,
} from "@stinventory/types";
import {
  resolveEngineAssets,
  resolveCustodian,
  resolveDestination,
  resolveProject,
} from "./entity-resolve.js";

const log = createLogger("messaging-worker");

const BATCH_SIZE = 5;

export async function processQueuedMessages(db: Database, env: ServerEnv): Promise<number> {
  const msgRows = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.processingStatus, "queued"))
    .orderBy(asc(schema.message.createdAt))
    .limit(BATCH_SIZE);

  if (msgRows.length === 0) return 0;

  const msgIds = msgRows.map((m) => m.id);

  /* Count the attempt on claim, not on failure: a message that kills the
     worker mid-parse would otherwise never increment and would be retried
     forever by the request worker. */
  await db
    .update(schema.message)
    .set({
      processingStatus: "processing",
      attempts: sql`${schema.message.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(inArray(schema.message.id, msgIds));

  for (const msg of msgRows) {
    try {
      await processOne(db, env, msg);
    } catch (err) {
      log.error("[messaging-worker] failed to process message", {
        msgId: msg.id,
        err: String(err),
      });
      await db
        .update(schema.message)
        .set({ processingStatus: "error", errorNote: String(err).slice(0, 500), updatedAt: new Date() })
        .where(eq(schema.message.id, msg.id));
    }
  }

  return msgRows.length;
}

/*
  What the author picked off the @ list, if anything.

  A vehicle mention is turned into the location row tools actually ride in —
  "@TRU-012" means "in truck 12", and the register points at the location, not
  the vehicle record.
*/
async function mentionSlots(
  db: Database,
  tid: string,
  raw: unknown,
): Promise<MentionSlots | null> {
  if (!Array.isArray(raw) || !raw.length) return null;
  const slots = slotsFromMentions(raw as ChatMention[]);

  if (!slots.locationId && slots.vehicleIds.length) {
    const veh = await db.query.vehicle.findFirst({
      where: and(eq(schema.vehicle.id, slots.vehicleIds[0]!), eq(schema.vehicle.tenantId, tid)),
    });
    if (veh) slots.locationId = veh.locationId;
  }
  return slots;
}

async function processOne(
  db: Database,
  env: ServerEnv,
  msg: typeof schema.message.$inferSelect,
): Promise<void> {
  const tid = msg.tenantId;
  const picked = await mentionSlots(db, tid, msg.mentions);

  let foremanName = "";
  let foremanRole = "";
  let primaryProject = "";
  let currentLocation = "";
  const currentAssignments: { tag: string; model: string; project: string; location: string }[] = [];

  if (msg.authorEmployeeId) {
    const emp = await db.query.employee.findFirst({
      where: and(eq(schema.employee.id, msg.authorEmployeeId), eq(schema.employee.tenantId, tid)),
    });
    if (emp) {
      foremanName = emp.name;
      foremanRole = emp.role;
      if (emp.primaryProjectId) {
        const proj = await db.query.project.findFirst({
          where: and(eq(schema.project.id, emp.primaryProjectId), eq(schema.project.tenantId, tid)),
        });
        if (proj) primaryProject = proj.name;
      }
    }

    const assigns = await db
      .select({
        tag: schema.asset.tag,
        make: schema.asset.make,
        modelNumber: schema.asset.modelNumber,
        description: schema.asset.description,
        projectName: schema.project.name,
        locationName: schema.location.name,
      })
      .from(schema.assignment)
      .innerJoin(schema.asset, eq(schema.assignment.assetId, schema.asset.id))
      .leftJoin(schema.project, eq(schema.assignment.projectId, schema.project.id))
      .leftJoin(schema.location, eq(schema.assignment.locationId, schema.location.id))
      .where(
        and(
          eq(schema.assignment.tenantId, tid),
          eq(schema.assignment.custodianId, msg.authorEmployeeId),
          eq(schema.assignment.status, "active"),
        ),
      );
    for (const a of assigns) {
      currentAssignments.push({
        tag: a.tag ?? "",
        model: formatAssetModel(a),
        project: a.projectName ?? "",
        location: a.locationName ?? "",
      });
    }
    if (assigns.length > 0 && assigns[0]?.locationName) {
      currentLocation = assigns[0].locationName;
    }
  }

  /* Newest ten, then flipped back into reading order.
     This was ascending, which took the OLDEST ten in the channel — so the
     "recent messages" the model saw were frozen at whatever was said first and
     stopped being relevant the moment a channel had any history. */
  const recent = await db
    .select({ body: schema.message.body })
    .from(schema.message)
    .where(
      and(eq(schema.message.channelId, msg.channelId), eq(schema.message.tenantId, tid)),
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(10);
  const recentMessages = recent.map((r) => r.body).reverse();

  /* Model configuration lives in tenant_settings so it can be changed from the
     settings page without a redeploy. Null means the tenant has not configured
     one, and parseIntent falls back to the process environment — a development
     convenience. With neither, the message goes to the desk's manual queue
     rather than being parsed against something arbitrary. */
  const llm = await llmConfigFor(db, tid, env.SESSION_SECRET);

  const engineResp = await parseIntent(env, {
    message: msg.body,
    ...(llm ? { llm } : {}),
    context: {
      foremanName,
      foremanRole,
      currentAssignments,
      primaryProject,
      currentLocation,
      recentMessages,
    },
  });

  if (engineResp.intent === "task") {
    const resolvedAssets = engineResp.entities.assets.length > 0
      ? await resolveEngineAssets(db, tid, engineResp.entities.assets)
      : [];
    /* A picked tool beats a matched one everywhere below: it was chosen off a
       list of real rows, not inferred from wording. */
    const relatedAssetId = picked?.assetIds[0] ?? (resolvedAssets.length > 0 ? resolvedAssets[0]!.id : null);
    const custodian = picked?.custodianId
      ? { id: picked.custodianId }
      : engineResp.entities.custodian?.raw
        ? await resolveCustodian(db, tid, engineResp.entities.custodian.raw)
        : null;
    const project = picked?.projectId
      ? { id: picked.projectId }
      : engineResp.entities.project?.raw
        ? await resolveProject(db, tid, engineResp.entities.project.raw)
        : null;
    const title = msg.body.length > 120 ? msg.body.slice(0, 117) + "..." : msg.body;
    await db.insert(schema.task).values({
      tenantId: tid,
      title,
      description: msg.body,
      assignedToEmployeeId: custodian?.id ?? null,
      relatedProjectId: project?.id ?? null,
      createdByUserId: msg.authorUserId,
      relatedAssetId,
      source: "chat",
      sourceMessageId: msg.id,
      status: "pending",
      priority: "medium",
    });
    await db
      .update(schema.message)
      .set({
        processingStatus: "action_executed",
        intentType: engineResp.intent,
        intentPayload: engineResp as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(schema.message.id, msg.id));
    return;
  }

  const isHighConfidence = engineResp.confidence >= 0.6 && engineResp.intent !== "none";

  /* Registering a tool and asking for one to be bought are the two intents
     whose subject is not in the register yet. Requiring a resolved asset would
     send every one of them to `pending_manual` — the absence of a match is the
     whole point. */
  const aboutNewTool = NEW_TOOL_INTENTS.has(engineResp.intent);

  const markPendingManual = () =>
    db
      .update(schema.message)
      .set({
        processingStatus: "pending_manual",
        intentType: engineResp.intent,
        intentPayload: engineResp as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(schema.message.id, msg.id));

  /* A picked tool is proof the author named something real, so the "no asset
     in this message" bail-out does not apply — that check exists to catch the
     parser hallucinating a subject, which is not a risk here. */
  const hasPickedAsset = !!picked?.assetIds.length;

  if (!isHighConfidence || (!aboutNewTool && !hasPickedAsset && !engineResp.entities.assets.length)) {
    await markPendingManual();
    return;
  }

  /* applyChatAction refuses an intake without a tag and at least one of make
     or description, so anything missing both goes to manual entry rather than
     becoming a card that can only fail on confirm. Small models routinely catch
     the tag and drop the model — "put it in as UIC-1100" — and that is a job
     for the desk's form, not a dead button. A tag plus something descriptive
     passes; the tag alone no longer does (docs/12 + docs/17). */
  const d = engineResp.draft;
  if (engineResp.intent === "intake" && !(d?.tag && (d?.make || d?.description))) {
    await markPendingManual();
    return;
  }

  const resolvedAssets = engineResp.entities.assets.length
    ? await resolveEngineAssets(db, tid, engineResp.entities.assets)
    : [];

  if (!aboutNewTool && !hasPickedAsset && resolvedAssets.length === 0) {
    await markPendingManual();
    return;
  }

  /* Only fall back to fuzzy resolution for the slots nobody filled by hand.
     Searching for a custodian in the raw message text is a last resort that
     regularly picks the wrong person — skipping it when someone was actually
     named off the list is most of the value of this feature. */
  const resolvedDest = picked?.custodianId || picked?.locationId
    ? null
    : await resolveDestination(db, tid, engineResp.entities.destination);
  const resolvedCust = picked?.custodianId
    ? null
    : await resolveCustodian(db, tid, engineResp.entities.custodian?.raw ?? msg.body);
  const resolvedProj = picked?.projectId
    ? null
    : await resolveProject(db, tid, engineResp.entities.project?.raw ?? "");

  /* A purchase request names a KIND of tool, not one in the register. The
     resolver will happily match "another rotary hammer" to whichever rotary
     hammer already exists, and linking it there would annotate an unrelated
     tool's history with somebody's shopping list. Drop the match and keep only
     the words. */
  const assetIds =
    engineResp.intent === "request_purchase"
      ? []
      : picked?.assetIds.length
        ? picked.assetIds
        : resolvedAssets.map((a) => a.id);
  const department = departmentForAction(engineResp.intent, engineResp.entities.assets);
  const proposedAction: Record<string, unknown> = {
    type: engineResp.intent,
    assetIds,
    department,
  };

  if (engineResp.intent === "assign" || engineResp.intent === "transfer") {
    if (picked?.custodianId) {
      proposedAction.custodianId = picked.custodianId;
    } else {
      const targetId = resolvedDest?.id ?? resolvedCust?.id;
      if (targetId && resolvedDest?.kind === "employee") {
        proposedAction.custodianId = targetId;
      } else if (targetId && resolvedDest?.kind === "location") {
        proposedAction.locationId = targetId;
      }
    }
    /* A named truck or gang box is where the tool ends up, whoever holds it. */
    if (picked?.locationId) proposedAction.locationId = picked.locationId;
    if (picked?.projectId) proposedAction.projectId = picked.projectId;
    else if (resolvedProj) proposedAction.projectId = resolvedProj.id;
  }

  /* Returning to a named place, or reporting from one, still wants the
     location recorded even though custody is not moving to a person. */
  if (!proposedAction.locationId && picked?.locationId) {
    proposedAction.locationId = picked.locationId;
  }

  if (engineResp.intent === "return") {
    proposedAction.type = "return";
  }
  if (engineResp.intent === "repair") {
    proposedAction.type = "repair";
  }
  if (engineResp.intent === "lost") {
    proposedAction.type = "lost";
  }

  /* Name what was asked for from the words in the message, since there is no
     row to point at. The split fields are folded back into one string — the
     draft an ask carries is prose, and description is where the parser put
     "another rotary hammer". */
  if (engineResp.intent === "request_purchase") {
    const wanted =
      formatAssetModel(engineResp.draft ?? {}) ||
      engineResp.entities.assets[0]?.label ||
      engineResp.entities.assets[0]?.raw ||
      null;
    if (wanted) proposedAction.draft = { description: wanted };
    if (picked?.projectId) proposedAction.projectId = picked.projectId;
    else if (resolvedProj) proposedAction.projectId = resolvedProj.id;
  }

  if (engineResp.intent === "intake" && engineResp.draft) {
    /* Carry only what the model actually stated. Nulls are dropped rather than
       written through, so a blank serial stays blank instead of becoming the
       string "null" in the register. */
    const d = engineResp.draft;
    proposedAction.draft = {
      ...(d.tag ? { tag: d.tag } : {}),
      ...(d.make ? { make: d.make } : {}),
      ...(d.modelNumber ? { modelNumber: d.modelNumber } : {}),
      ...(d.description ? { description: d.description } : {}),
      ...(d.serialNumber ? { serialNumber: d.serialNumber } : {}),
      ...(d.categoryName ? { categoryName: d.categoryName } : {}),
      ...(d.acquisitionCost ? { acquisitionCost: d.acquisitionCost } : {}),
    };
    if (picked?.projectId) proposedAction.projectId = picked.projectId;
    else if (resolvedProj) proposedAction.projectId = resolvedProj.id;
    if (picked?.locationId) proposedAction.locationId = picked.locationId;
    else if (resolvedDest?.kind === "location") proposedAction.locationId = resolvedDest.id;
  }

  // Anything that moves custody or changes status waits for a human, however
  // confident the model is. Model confidence is an input to the workflow, not
  // authority over it (docs/06-decisions.md ADR-4). Only annotations
  // auto-apply.
  const autoSafe = AUTO_SAFE_INTENTS.has(engineResp.intent);

  if (autoSafe && !engineResp.needsConfirmation) {
    await autoExecuteAction(db, tid, msg, engineResp, proposedAction, assetIds);
  } else {
    await db
      .update(schema.message)
      .set({
        processingStatus: "action_proposed",
        intentType: engineResp.intent,
        intentPayload: engineResp as Record<string, unknown>,
        proposedAction,
        updatedAt: new Date(),
      })
      .where(eq(schema.message.id, msg.id));
  }
}

async function autoExecuteAction(
  db: Database,
  tid: string,
  msg: typeof schema.message.$inferSelect,
  engineResp: EngineParseResponse,
  proposedAction: Record<string, unknown>,
  assetIds: string[],
): Promise<void> {
  // Same executor the confirm path uses. Throws instead of reporting a
  // success it did not perform; the caller marks the message `error`.
  //
  // The worker has no session, so it runs with an empty permission set. That is
  // deliberate: only `report` costs nothing, and AUTO_SAFE_INTENTS already
  // limits this path to report/task. Any future intent added to AUTO_SAFE_INTENTS
  // that moves custody will be refused here rather than applied unattended.
  if (assetIds.length) {
    await applyChatAction(db, {
      tenantId: tid,
      actorUserId: msg.authorUserId,
      permissions: new Set<Permission>(),
      action: { ...(proposedAction as ChatAction), note: engineResp.replyText || msg.body },
      refMessageId: msg.id,
    });
  }

  await db
    .update(schema.message)
    .set({
      processingStatus: "action_executed",
      intentType: engineResp.intent,
      intentPayload: engineResp as Record<string, unknown>,
      proposedAction,
      updatedAt: new Date(),
    })
    .where(eq(schema.message.id, msg.id));
}
