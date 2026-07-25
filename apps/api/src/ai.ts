import type { Database } from "@stinventory/db";
import type { ResolvedSession } from "@stinventory/auth";
import * as schema from "@stinventory/db/schema";
import { and, eq, ilike, or } from "drizzle-orm";
import { serverEnv } from "@stinventory/env";
import { parseIntent } from "./engine-client.js";
import type { EngineParseResponse } from "./engine-types.js";
import {
  resolveEngineAssets,
  resolveCustodian,
  resolveDestination,
  resolveProject,
} from "./entity-resolve.js";

type IntentInfo = {
  type: string;
  department: string;
  status: string;
  details?: Record<string, unknown>;
};

type ActionResult = { ok: boolean; message: string; intent?: IntentInfo };

export function determineDepartment(intent: string, entities?: { assets?: { label: string }[] }): string {
  if (intent === "repair") return "Maintenance";
  if (intent === "return") return "Warehouse";
  if (intent === "lost") return "Equipment Admin";
  if (intent === "report") return "Equipment Admin";
  if (intent === "task") return "Equipment Admin";
  if (intent === "request_purchase") return "Procurement";
  if (intent === "assign" || intent === "transfer") {
    if (entities?.assets?.some((a) => /TRU|TRA|trailer|truck/i.test(a.label))) return "Fleet";
    return "Equipment Yard";
  }
  return "Equipment Admin";
}

// ── Inline regex fallback ────────────────────────────────────────────────────

type EntityMatch = { type: "asset" | "employee" | "project" | "vehicle"; id: string; label: string };

function extractTag(text: string): string | null {
  const m = text.match(/\b(?:UIC[- ])?(\d{3,4})\b/i);
  if (m) return m[0].toUpperCase().includes("UIC") ? m[0].toUpperCase() : `UIC-${m[1]!}`;
  const veh = text.match(/\b(TR[AU]-\d{3})\b/i);
  return veh ? veh[1]!.toUpperCase() : null;
}

function searchTokens(text: string): string[] {
  return text.toLowerCase().split(/[\s,]+/).filter(Boolean);
}

async function matchEntityLocal(db: Database, tid: string, text: string): Promise<EntityMatch | null> {
  const tag = extractTag(text);
  if (tag) {
    const a = await db.query.asset.findFirst({ where: and(eq(schema.asset.tag, tag), eq(schema.asset.tenantId, tid)) });
    if (a) return { type: "asset", id: a.id, label: `${a.tag} (${a.modelName})` };
    const v = await db.query.vehicle.findFirst({ where: and(eq(schema.vehicle.unit, tag), eq(schema.vehicle.tenantId, tid)) });
    if (v) return { type: "vehicle", id: v.id, label: v.unit };
  }
  const tokens = searchTokens(text);
  for (const token of tokens) {
    if (token.length < 2) continue;
    const emp = await db.query.employee.findFirst({
      where: and(eq(schema.employee.tenantId, tid), or(ilike(schema.employee.name, `%${token}%`), ilike(schema.employee.externalId, token))),
    });
    if (emp) return { type: "employee", id: emp.id, label: `${emp.name} #${emp.externalId ?? ""}` };
    const proj = await db.query.project.findFirst({
      where: and(eq(schema.project.tenantId, tid), ilike(schema.project.name, `%${token}%`)),
    });
    if (proj) return { type: "project", id: proj.id, label: proj.name };
    const asset = await db.query.asset.findFirst({
      where: and(eq(schema.asset.tenantId, tid), ilike(schema.asset.modelName, `%${token}%`)),
    });
    if (asset) return { type: "asset", id: asset.id, label: `${asset.tag} (${asset.modelName})` };
  }
  return null;
}

async function resolveCustodianLocal(db: Database, tid: string, text: string): Promise<{ id: string; name: string } | null> {
  const tokens = searchTokens(text);
  for (const token of tokens) {
    if (token.length < 2) continue;
    const emp = await db.query.employee.findFirst({
      where: and(
        eq(schema.employee.tenantId, tid), eq(schema.employee.role, "foreman"),
        eq(schema.employee.employmentStatus, "active"),
        or(ilike(schema.employee.name, `%${token}%`), ilike(schema.employee.externalId, token)),
      ),
    });
    if (emp) return { id: emp.id, name: emp.name };
  }
  return null;
}

function inferIntent(text: string): "assign" | "return" | "report" | "lost" | "repair" | "transfer" | "task" | "help" | null {
  const t = text.toLowerCase();
  if (/give|assign|hand|issue|check.?out/.test(t)) return "assign";
  if (/return|bring.?back|give.?back/.test(t)) return "return";
  if (/lost|missing|cant.?find/.test(t)) return "lost";
  if (/broken|damage|repair|fix|maintenance|not.?working/.test(t)) return "repair";
  if (/transfer|move|relocate|give.?to/.test(t)) return "transfer";
  if (/report|issue|problem|note/.test(t)) return "report";
  if (/task|todo|need.*done|check|can you|schedule|organize|make sure|remember to|follow.?up/.test(t)) return "task";
  if (/help|what|how|can you/i.test(t) && t.length < 60) return "help";
  return null;
}

async function handleWithRegex(db: Database, session: ResolvedSession, message: string): Promise<ActionResult> {
  const tid = session.tenantId;
  const intent = inferIntent(message);
  if (!intent) return { ok: true, message: "I'm not sure what you want to do. Try:\n• `give UIC-1001 to Miguel`\n• `return UIC-1002`\n• `UIC-1008 is broken`\n• `report issue with UIC-1003`\n• `UIC-1013 is lost`\n• `check the generator on Friday`" };
  if (intent === "help") return { ok: true, message: "You can tell me things like:\n• *give UIC-1001 to Miguel* — assign a tool\n• *return UIC-1002* — return to warehouse\n• *UIC-1008 is broken* — mark for repair\n• *UIC-1013 is lost* — report missing\n• *TRA-001 issue* — note on equipment\n• *check the generator on Friday* — create a task" };

  if (intent === "task") {
    const match = await matchEntityLocal(db, tid, message);
    const relatedAssetId = match?.type === "asset" ? match.id : null;
    const custodian = await resolveCustodianLocal(db, tid, message);
    const title = message.length > 120 ? message.slice(0, 117) + "..." : message;
    await db.insert(schema.task).values({
      tenantId: tid,
      title,
      description: message,
      assignedToEmployeeId: custodian?.id ?? null,
      createdByUserId: session.userId,
      relatedAssetId,
      source: "chat",
      status: "pending",
      priority: "medium",
    });
    const assignMsg = custodian ? ` assigned to **${custodian.name}**` : "";
    return { ok: true, message: `📋 Task created${assignMsg}: "${message}"` };
  }

  const asset = await matchEntityLocal(db, tid, message);
  if (!asset || asset.type !== "asset") return { ok: false, message: "I couldn't find which tool you're talking about. Try using its tag like **UIC-1001** or a model name." };
  const tool = await db.query.asset.findFirst({ where: eq(schema.asset.id, asset.id) });
  if (!tool) return { ok: false, message: "Tool not found." };

  if (intent === "return") {
    const existing = await db.query.assignment.findFirst({ where: and(eq(schema.assignment.assetId, asset.id), eq(schema.assignment.status, "active"), eq(schema.assignment.tenantId, tid)) });
    if (!existing) return { ok: true, message: `${tool.tag} (${tool.modelName}) isn't currently assigned to anyone.` };
    await db.update(schema.assignment).set({ status: "returned", returnedAt: new Date(), updatedAt: new Date() }).where(eq(schema.assignment.id, existing.id));
    await db.update(schema.asset).set({ currentStatus: "available", currentCustodianId: null, updatedAt: new Date() }).where(eq(schema.asset.id, asset.id));
    await db.insert(schema.transaction).values({ tenantId: tid, assetId: asset.id, eventType: "return", actorId: session.userId, toState: { status: "available", custodianId: null, projectId: null, locationId: null }, refType: "assignment", refId: existing.id, note: "Returned via AI chat" });
    return { ok: true, message: `✅ **${tool.tag}** (${tool.modelName}) has been **returned** and is now available in the warehouse.` };
  }

  if (intent === "assign") {
    const custodian = await resolveCustodianLocal(db, tid, message);
    if (!custodian) return { ok: false, message: `Who should I assign ${tool.tag} to? Say something like "give ${tool.tag} to Miguel"` };
    if (tool.currentCustodianId) return { ok: false, message: `${tool.tag} is already assigned to someone. Return it first, or transfer by saying "transfer ${tool.tag} to ${custodian.name}"` };
    const [row] = await db.insert(schema.assignment).values({ tenantId: tid, assetId: asset.id, custodianId: custodian.id, type: "permanent", startDate: new Date().toISOString().slice(0, 10), status: "active", approvedBy: session.userId }).returning();
    await db.update(schema.asset).set({ currentStatus: "assigned", currentCustodianId: custodian.id, updatedAt: new Date() }).where(eq(schema.asset.id, asset.id));
    await db.insert(schema.transaction).values({ tenantId: tid, assetId: asset.id, eventType: "assign", actorId: session.userId, toState: { status: "assigned", custodianId: custodian.id, projectId: null, locationId: null }, refType: "assignment", refId: row!.id, note: "Assigned via AI chat" });
    return { ok: true, message: `✅ **${tool.tag}** (${tool.modelName}) assigned to **${custodian.name}**.` };
  }

  if (intent === "repair") {
    await db.update(schema.asset).set({ currentStatus: "in_maintenance", updatedAt: new Date() }).where(eq(schema.asset.id, asset.id));
    await db.insert(schema.transaction).values({ tenantId: tid, assetId: asset.id, eventType: "repair_start", actorId: session.userId, toState: { status: "in_maintenance" }, refType: "manual", note: message });
    return { ok: true, message: `🔧 **${tool.tag}** (${tool.modelName}) marked for **repair**. Maintenance will follow up.` };
  }

  if (intent === "lost") {
    await db.update(schema.asset).set({ currentStatus: "lost", updatedAt: new Date() }).where(eq(schema.asset.id, asset.id));
    await db.insert(schema.transaction).values({ tenantId: tid, assetId: asset.id, eventType: "lost", actorId: session.userId, toState: { status: "lost" }, refType: "manual", note: message });
    return { ok: true, message: `⚠️ **${tool.tag}** (${tool.modelName}) reported **lost**. Notifying equipment admin.` };
  }

  if (intent === "report") {
    const tool2 = await db.query.asset.findFirst({ where: eq(schema.asset.id, asset.id) });
    await db.insert(schema.transaction).values({ tenantId: tid, assetId: asset.id, eventType: "status_change", actorId: session.userId, toState: { status: tool2?.currentStatus ?? "unknown" }, refType: "manual", note: message });
    return { ok: true, message: `📝 Noted on **${tool.tag}**: "${message}"` };
  }

  if (intent === "transfer") {
    const custodian = await resolveCustodianLocal(db, tid, message);
    if (!custodian) return { ok: true, message: `Please use the Transfer form to move ${tool.tag} (${tool.modelName}) to another foreman. Open the tool card → "Transfer".` };
    return { ok: true, message: `Please use the Transfer form to give ${tool.tag} (${tool.modelName}) to **${custodian.name}**. Open the tool card → "Transfer".` };
  }

  return { ok: false, message: "Couldn't process that. Try `help` to see what I can do." };
}

// ── Engine-based execution ───────────────────────────────────────────────────

async function handleWithEngine(
  db: Database,
  session: ResolvedSession,
  message: string,
  engine: EngineParseResponse,
): Promise<ActionResult> {
  const tid = session.tenantId;
  const intent = engine.intent;

  if (intent === "task") {
    const resolvedAssets = engine.entities.assets.length > 0
      ? await resolveEngineAssets(db, tid, engine.entities.assets)
      : [];
    const relatedAssetId = resolvedAssets.length > 0 ? resolvedAssets[0]!.id : null;
    const custodian = engine.entities.custodian?.raw
      ? await resolveCustodian(db, tid, engine.entities.custodian.raw)
      : null;
    const project = engine.entities.project?.raw
      ? await resolveProject(db, tid, engine.entities.project.raw)
      : null;
    const title = message.length > 120 ? message.slice(0, 117) + "..." : message;
    await db.insert(schema.task).values({
      tenantId: tid,
      title,
      description: message,
      assignedToEmployeeId: custodian?.id ?? null,
      relatedProjectId: project?.id ?? null,
      createdByUserId: session.userId,
      relatedAssetId,
      source: "chat",
      status: "pending",
      priority: "medium",
    });
    return { ok: true, message: engine.replyText || `📋 Task created.` };
  }

  if (intent === "none" || !engine.entities.assets.length) {
    return { ok: true, message: engine.replyText || "I'm not sure what you want to do. Try something like:\n• `give UIC-1001 to Miguel`\n• `return UIC-1002`" };
  }

  const resolvedAssets = await resolveEngineAssets(db, tid, engine.entities.assets);
  if (resolvedAssets.length === 0) {
    return { ok: false, message: "I couldn't find the tools you mentioned. Try using their tag numbers like **UIC-1001**." };
  }

  if (intent === "return") {
    const assetId = resolvedAssets[0]!.id;
    const tool = await db.query.asset.findFirst({ where: eq(schema.asset.id, assetId) });
    if (!tool) return { ok: false, message: "Tool not found." };
    const existing = await db.query.assignment.findFirst({ where: and(eq(schema.assignment.assetId, assetId), eq(schema.assignment.status, "active"), eq(schema.assignment.tenantId, tid)) });
    if (!existing) return { ok: true, message: engine.replyText || `${tool.tag} (${tool.modelName}) isn't currently assigned.` };
    await db.update(schema.assignment).set({ status: "returned", returnedAt: new Date(), updatedAt: new Date() }).where(eq(schema.assignment.id, existing.id));
    await db.update(schema.asset).set({ currentStatus: "available", currentCustodianId: null, updatedAt: new Date() }).where(eq(schema.asset.id, assetId));
    await db.insert(schema.transaction).values({ tenantId: tid, assetId, eventType: "return", actorId: session.userId, toState: { status: "available", custodianId: null, projectId: null, locationId: null }, refType: "assignment", refId: existing.id, note: "Returned via AI chat" });
    return { ok: true, message: engine.replyText || `✅ **${tool.tag}** has been returned.` };
  }

  if (intent === "assign") {
    let destEmployee: { id: string; name: string } | null = null;
    if (engine.entities.custodian?.raw) {
      destEmployee = await resolveCustodian(db, tid, engine.entities.custodian.raw);
    }
    if (!destEmployee && engine.entities.destination?.raw) {
      destEmployee = await resolveCustodian(db, tid, engine.entities.destination.raw);
    }
    if (!destEmployee) return { ok: false, message: "Who should I assign the tool to? Say something like `give UIC-1001 to Miguel`" };

    for (const ra of resolvedAssets) {
      const tool2 = await db.query.asset.findFirst({ where: eq(schema.asset.id, ra.id) });
      if (!tool2) continue;
      if (tool2.currentCustodianId) continue;
      const [row] = await db.insert(schema.assignment).values({ tenantId: tid, assetId: ra.id, custodianId: destEmployee.id, type: "permanent", startDate: new Date().toISOString().slice(0, 10), status: "active", approvedBy: session.userId }).returning();
      await db.update(schema.asset).set({ currentStatus: "assigned", currentCustodianId: destEmployee.id, updatedAt: new Date() }).where(eq(schema.asset.id, ra.id));
      await db.insert(schema.transaction).values({ tenantId: tid, assetId: ra.id, eventType: "assign", actorId: session.userId, toState: { status: "assigned", custodianId: destEmployee.id, projectId: null, locationId: null }, refType: "assignment", refId: row!.id, note: "Assigned via AI chat" });
    }
    return { ok: true, message: engine.replyText || `✅ Tools assigned to **${destEmployee.name}**.` };
  }

  if (intent === "transfer") {
    let destEmployee: { id: string; name: string } | null = null;
    if (engine.entities.destination?.raw) {
      destEmployee = await resolveCustodian(db, tid, engine.entities.destination.raw);
    }
    if (!destEmployee && engine.entities.custodian?.raw) {
      destEmployee = await resolveCustodian(db, tid, engine.entities.custodian.raw);
    }
    if (!destEmployee) {
      const dest = await resolveDestination(db, tid, engine.entities.destination);
      if (dest && dest.kind === "location") {
        for (const ra of resolvedAssets) {
          await db.update(schema.asset).set({ currentLocationId: dest.id, updatedAt: new Date() }).where(eq(schema.asset.id, ra.id));
          await db.insert(schema.transaction).values({ tenantId: tid, assetId: ra.id, eventType: "transfer", actorId: session.userId, toState: { locationId: dest.id }, refType: "manual", note: "Transferred via AI chat" });
        }
        return { ok: true, message: engine.replyText || `✅ Tools moved to **${dest.label}**.` };
      }
      return { ok: false, message: "Who should I transfer the tool to? Say something like `transfer UIC-1001 to Miguel`" };
    }
    for (const ra of resolvedAssets) {
      const tool2 = await db.query.asset.findFirst({ where: eq(schema.asset.id, ra.id) });
      if (!tool2) continue;
      await db.update(schema.asset).set({ currentCustodianId: destEmployee.id, updatedAt: new Date() }).where(eq(schema.asset.id, ra.id));
      await db.insert(schema.transaction).values({ tenantId: tid, assetId: ra.id, eventType: "transfer", actorId: session.userId, fromState: { custodianId: tool2.currentCustodianId }, toState: { custodianId: destEmployee.id }, refType: "manual", note: "Transferred via AI chat" });
    }
    return { ok: true, message: engine.replyText || `✅ Tools transferred to **${destEmployee.name}**.` };
  }

  if (intent === "repair") {
    for (const ra of resolvedAssets) {
      await db.update(schema.asset).set({ currentStatus: "in_maintenance", updatedAt: new Date() }).where(eq(schema.asset.id, ra.id));
      await db.insert(schema.transaction).values({ tenantId: tid, assetId: ra.id, eventType: "repair_start", actorId: session.userId, toState: { status: "in_maintenance" }, refType: "manual", note: message });
    }
    return { ok: true, message: engine.replyText || `🔧 Tools marked for repair.` };
  }

  if (intent === "lost") {
    for (const ra of resolvedAssets) {
      await db.update(schema.asset).set({ currentStatus: "lost", updatedAt: new Date() }).where(eq(schema.asset.id, ra.id));
      await db.insert(schema.transaction).values({ tenantId: tid, assetId: ra.id, eventType: "lost", actorId: session.userId, toState: { status: "lost" }, refType: "manual", note: message });
    }
    return { ok: true, message: engine.replyText || `⚠️ Tools reported lost. Equipment admin notified.` };
  }

  if (intent === "report") {
    for (const ra of resolvedAssets) {
      await db.insert(schema.transaction).values({ tenantId: tid, assetId: ra.id, eventType: "status_change", actorId: session.userId, toState: {}, refType: "manual", note: message });
    }
    return { ok: true, message: engine.replyText || `📝 Noted.` };
  }

  return handleWithRegex(db, session, message);
}

// ── Main entry point ─────────────────────────────────────────────────────────

async function createTaskForUnrecognized(
  db: Database,
  session: ResolvedSession,
  message: string,
): Promise<ActionResult> {
  const tid = session.tenantId;
  const title = message.length > 120 ? message.slice(0, 117) + "..." : message;
  await db.insert(schema.task).values({
    tenantId: tid,
    title,
    description: message,
    createdByUserId: session.userId,
    source: "chat",
    status: "pending",
    priority: "medium",
  });
  return {
    ok: true,
    message: `📋 Noted — created a task for review: "${message}"`,
    intent: { type: "task", department: "Equipment Admin", status: "pending_verification" },
  };
}

export async function handleAiChat(db: Database, session: ResolvedSession, message: string): Promise<ActionResult> {
  // Build context for the LLM
  let foremanName = "";
  let foremanRole = "";
  let primaryProject = "";
  let currentLocation = "";
  const currentAssignments: { tag: string; model: string; project: string; location: string }[] = [];

  if (session.employeeId) {
    const emp = await db.query.employee.findFirst({
      where: and(eq(schema.employee.id, session.employeeId), eq(schema.employee.tenantId, session.tenantId)),
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
      .select({ tag: schema.asset.tag, modelName: schema.asset.modelName, projectName: schema.project.name, locationName: schema.location.name })
      .from(schema.assignment)
      .innerJoin(schema.asset, eq(schema.assignment.assetId, schema.asset.id))
      .leftJoin(schema.project, eq(schema.assignment.projectId, schema.project.id))
      .leftJoin(schema.location, eq(schema.assignment.locationId, schema.location.id))
      .where(and(eq(schema.assignment.tenantId, session.tenantId), eq(schema.assignment.custodianId, session.employeeId), eq(schema.assignment.status, "active")));
    for (const a of assigns) {
      currentAssignments.push({ tag: a.tag, model: a.modelName, project: a.projectName ?? "", location: a.locationName ?? "" });
    }
    if (assigns[0]?.locationName) currentLocation = assigns[0].locationName;
  }

  // Try direct LLM parsing
  const env = serverEnv();
  if (env.LLM_API_KEY) {
    const engineResp = await parseIntent(env, {
      message,
      context: { foremanName, foremanRole, currentAssignments, primaryProject, currentLocation, recentMessages: [] },
    });
    if (engineResp.intent !== "none" && engineResp.confidence >= 0.3) {
      const result = await handleWithEngine(db, session, message, engineResp);
      const department = determineDepartment(engineResp.intent, engineResp.entities);
      result.intent = { type: engineResp.intent, department, status: result.ok ? "pending_verification" : "error" };
      return result;
    }
  }

  // Fallback: regex-based detection
  const intent = inferIntent(message);
  const result = await handleWithRegex(db, session, message);
  if (intent && intent !== "help") {
    const department = determineDepartment(intent);
    result.intent = { type: intent, department, status: result.ok ? "pending_verification" : "error" };
    return result;
  }
  // Out-of-scope: no intent matched. Create a task for admin review.
  return createTaskForUnrecognized(db, session, message);
}
