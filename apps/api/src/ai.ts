import type { Database } from "@stinventory/db";
import type { ResolvedSession } from "@stinventory/auth";
import * as schema from "@stinventory/db/schema";
import { and, eq, ilike, or, sql } from "drizzle-orm";

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

async function matchEntity(db: Database, tid: string, text: string): Promise<EntityMatch | null> {
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
      where: and(
        eq(schema.employee.tenantId, tid),
        or(
          ilike(schema.employee.name, `%${token}%`),
          ilike(schema.employee.externalId, token),
        ),
      ),
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

async function resolveCustodian(db: Database, tid: string, text: string): Promise<{ id: string; name: string } | null> {
  const tokens = searchTokens(text);
  for (const token of tokens) {
    if (token.length < 2) continue;
    const emp = await db.query.employee.findFirst({
      where: and(eq(schema.employee.tenantId, tid), eq(schema.employee.role, "foreman"), eq(schema.employee.employmentStatus, "active"),
        or(ilike(schema.employee.name, `%${token}%`), ilike(schema.employee.externalId, token)),
      ),
    });
    if (emp) return { id: emp.id, name: emp.name };
  }
  return null;
}

function inferIntent(text: string): "assign" | "return" | "report" | "lost" | "repair" | "transfer" | "help" | null {
  const t = text.toLowerCase();
  if (/give|assign|hand|issue|check.?out/.test(t)) return "assign";
  if (/return|bring.?back|give.?back/.test(t)) return "return";
  if (/lost|missing|cant.?find/.test(t)) return "lost";
  if (/broken|damage|repair|fix|maintenance|not.?working/.test(t)) return "repair";
  if (/transfer|move|relocate|give.?to/.test(t)) return "transfer";
  if (/report|issue|problem|note/.test(t)) return "report";
  if (/help|what|how|can you/i.test(t) && t.length < 60) return "help";
  return null;
}

type ActionResult = { ok: boolean; message: string };

export async function handleAiChat(db: Database, session: ResolvedSession, message: string): Promise<ActionResult> {
  const tid = session.tenantId;
  const intent = inferIntent(message);
  if (!intent) return { ok: true, message: "I'm not sure what you want to do. Try:\n• `give UIC-1001 to Miguel`\n• `return UIC-1002`\n• `UIC-1008 is broken`\n• `report issue with UIC-1003`\n• `UIC-1013 is lost`" };

  if (intent === "help") {
    return { ok: true, message: "You can tell me things like:\n• *give UIC-1001 to Miguel* — assign a tool\n• *return UIC-1002* — return to warehouse\n• *UIC-1008 is broken* — mark for repair\n• *UIC-1013 is lost* — report missing\n• *TRA-001 issue* — note on equipment" };
  }

  const asset = await matchEntity(db, tid, message);
  if (!asset || asset.type !== "asset") {
    return { ok: false, message: `I couldn't find which tool you're talking about. Try using its tag like **UIC-1001** or a model name.` };
  }
  const tool = await db.query.asset.findFirst({ where: eq(schema.asset.id, asset.id) });
  if (!tool) return { ok: false, message: "Tool not found." };

  if (intent === "return") {
    const existing = await db.query.assignment.findFirst({
      where: and(eq(schema.assignment.assetId, asset.id), eq(schema.assignment.status, "active"), eq(schema.assignment.tenantId, tid)),
    });
    if (!existing) return { ok: true, message: `${tool.tag} (${tool.modelName}) isn't currently assigned to anyone.` };

    await db.update(schema.assignment).set({ status: "returned", returnedAt: new Date(), updatedAt: new Date() }).where(eq(schema.assignment.id, existing.id));
    await db.update(schema.asset).set({ currentStatus: "available", currentCustodianId: null, updatedAt: new Date() }).where(eq(schema.asset.id, asset.id));
    await db.insert(schema.transaction).values({
      tenantId: tid, assetId: asset.id, eventType: "return", actorId: session.userId,
      toState: { status: "available", custodianId: null, projectId: null, locationId: null },
      refType: "assignment", refId: existing.id, note: "Returned via AI chat",
    });
    return { ok: true, message: `✅ **${tool.tag}** (${tool.modelName}) has been **returned** and is now available in the warehouse.` };
  }

  if (intent === "assign") {
    const custodian = await resolveCustodian(db, tid, message);
    if (!custodian) return { ok: false, message: `Who should I assign ${tool.tag} to? Say something like "give ${tool.tag} to Miguel"` };

    if (tool.currentCustodianId) {
      return { ok: false, message: `${tool.tag} is already assigned to someone. Return it first, or transfer it by saying "transfer ${tool.tag} to ${custodian.name}"` };
    }

    const [row] = await db.insert(schema.assignment).values({
      tenantId: tid, assetId: asset.id, custodianId: custodian.id,
      type: "permanent", startDate: new Date().toISOString().slice(0, 10),
      status: "active", approvedBy: session.userId,
    }).returning();
    await db.update(schema.asset).set({
      currentStatus: "assigned", currentCustodianId: custodian.id, updatedAt: new Date(),
    }).where(eq(schema.asset.id, asset.id));
    await db.insert(schema.transaction).values({
      tenantId: tid, assetId: asset.id, eventType: "assign", actorId: session.userId,
      toState: { status: "assigned", custodianId: custodian.id, projectId: null, locationId: null },
      refType: "assignment", refId: row!.id, note: "Assigned via AI chat",
    });
    return { ok: true, message: `✅ **${tool.tag}** (${tool.modelName}) assigned to **${custodian.name}**.` };
  }

  if (intent === "repair") {
    await db.update(schema.asset).set({ currentStatus: "in_maintenance", updatedAt: new Date() }).where(eq(schema.asset.id, asset.id));
    await db.insert(schema.transaction).values({
      tenantId: tid, assetId: asset.id, eventType: "repair_start", actorId: session.userId,
      toState: { status: "in_maintenance" }, refType: "manual", note: message,
    });
    return { ok: true, message: `🔧 **${tool.tag}** (${tool.modelName}) marked for **repair**. Maintenance will follow up.` };
  }

  if (intent === "lost") {
    await db.update(schema.asset).set({ currentStatus: "lost", updatedAt: new Date() }).where(eq(schema.asset.id, asset.id));
    await db.insert(schema.transaction).values({
      tenantId: tid, assetId: asset.id, eventType: "lost", actorId: session.userId,
      toState: { status: "lost" }, refType: "manual", note: message,
    });
    return { ok: true, message: `⚠️ **${tool.tag}** (${tool.modelName}) reported **lost**. Notifying equipment admin.` };
  }

  if (intent === "report") {
    await db.insert(schema.transaction).values({
      tenantId: tid, assetId: asset.id, eventType: "status_change", actorId: session.userId,
      toState: { status: tool.currentStatus }, refType: "manual", note: message,
    });
    return { ok: true, message: `📝 Noted on **${tool.tag}**: "${message}"` };
  }

  if (intent === "transfer") {
    const custodian = await resolveCustodian(db, tid, message);
    if (!custodian) {
      return {
        ok: true,
        message: `Please use the Transfer form to move ${tool.tag} (${tool.modelName}) to another foreman. Open the tool card → "Transfer".`,
      };
    }
    return {
      ok: true,
      message: `Please use the Transfer form to give ${tool.tag} (${tool.modelName}) to **${custodian.name}**. Open the tool card → "Transfer".`,
    };
  }

  return { ok: false, message: "Couldn't process that. Try `help` to see what I can do." };
}
