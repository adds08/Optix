import { and, asc, eq, inArray } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import type { ServerEnv } from "@stinventory/env";
import { createLogger } from "@stinventory/logger";
import { parseIntent } from "./engine-client.js";
import type { EngineParseResponse } from "./engine-types.js";
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

  await db
    .update(schema.message)
    .set({ processingStatus: "processing", updatedAt: new Date() })
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

async function processOne(
  db: Database,
  env: ServerEnv,
  msg: typeof schema.message.$inferSelect,
): Promise<void> {
  const tid = msg.tenantId;

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
        const proj = await db.query.project.findFirst({ where: eq(schema.project.id, emp.primaryProjectId) });
        if (proj) primaryProject = proj.name;
      }
    }

    const assigns = await db
      .select({
        tag: schema.asset.tag,
        modelName: schema.asset.modelName,
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
        tag: a.tag,
        model: a.modelName,
        project: a.projectName ?? "",
        location: a.locationName ?? "",
      });
    }
    if (assigns.length > 0 && assigns[0]?.locationName) {
      currentLocation = assigns[0].locationName;
    }
  }

  const recent = await db
    .select({ body: schema.message.body })
    .from(schema.message)
    .where(
      and(eq(schema.message.channelId, msg.channelId), eq(schema.message.tenantId, tid)),
    )
    .orderBy(asc(schema.message.createdAt))
    .limit(10);
  const recentMessages = recent.map((r) => r.body);

  const engineResp = await parseIntent(env, {
    message: msg.body,
    context: {
      foremanName,
      foremanRole,
      currentAssignments,
      primaryProject,
      currentLocation,
      recentMessages,
    },
  });

  const isHighConfidence = engineResp.confidence >= 0.6 && engineResp.intent !== "none";

  if (!isHighConfidence || !engineResp.entities.assets.length) {
    await db
      .update(schema.message)
      .set({
        processingStatus: "pending_manual",
        intentType: engineResp.intent,
        intentPayload: engineResp as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(schema.message.id, msg.id));
    return;
  }

  const resolvedAssets = await resolveEngineAssets(db, tid, engineResp.entities.assets);

  if (resolvedAssets.length === 0) {
    await db
      .update(schema.message)
      .set({
        processingStatus: "pending_manual",
        intentType: engineResp.intent,
        intentPayload: engineResp as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(schema.message.id, msg.id));
    return;
  }

  const resolvedDest = await resolveDestination(db, tid, engineResp.entities.destination);
  const resolvedCust = await resolveCustodian(db, tid, engineResp.entities.custodian?.raw ?? msg.body);
  const resolvedProj = await resolveProject(db, tid, engineResp.entities.project?.raw ?? "");

  const assetIds = resolvedAssets.map((a) => a.id);
  const proposedAction: Record<string, unknown> = {
    type: engineResp.intent,
    assetIds,
  };

  if (engineResp.intent === "assign" || engineResp.intent === "transfer") {
    const targetId = resolvedDest?.id ?? resolvedCust?.id;
    if (targetId && resolvedDest?.kind === "employee") {
      proposedAction.custodianId = targetId;
    } else if (targetId && resolvedDest?.kind === "location") {
      proposedAction.locationId = targetId;
    }
    if (resolvedProj) proposedAction.projectId = resolvedProj.id;
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

  const allResolved = engineResp.intent !== "none" &&
    (engineResp.intent === "report" ||
     engineResp.intent === "return" ||
     engineResp.intent === "repair" ||
     engineResp.intent === "lost" ||
     (["assign", "transfer"].includes(engineResp.intent) && !!proposedAction.custodianId));

  if (allResolved && !engineResp.needsConfirmation) {
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
  if (engineResp.intent === "report") {
    for (const assetId of assetIds) {
      await db.insert(schema.transaction).values({
        tenantId: tid,
        assetId,
        eventType: "status_change",
        actorId: msg.authorUserId,
        toState: {},
        refType: "message",
        refId: msg.id,
        note: engineResp.replyText || msg.body,
      });
    }
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
