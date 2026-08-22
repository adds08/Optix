import type { Database } from "@stinventory/db";
import * as schema from "@stinventory/db/schema";
import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { CUSTODIAN_ROLES, formatAssetModel } from "@stinventory/types";

export type EntityMatch = { type: "asset" | "employee" | "project" | "vehicle" | "location"; id: string; label: string };

function extractTag(text: string): string | null {
  const m = text.match(/\b(?:UIC[- ])?(\d{3,4})\b/i);
  if (m) return m[0].toUpperCase().includes("UIC") ? m[0].toUpperCase() : `UIC-${m[1]!}`;
  const veh = text.match(/\b(TR[AU]-\d{3})\b/i);
  return veh ? veh[1]!.toUpperCase() : null;
}

function searchTokens(text: string): string[] {
  return text.toLowerCase().split(/[\s,]+/).filter(Boolean);
}

// Try to match a single entity from raw text. Searches by tag first (asset/vehicle),
// then by token match on name/externalId/model fields.
export async function matchEntity(
  db: Database,
  tid: string,
  text: string,
): Promise<EntityMatch | null> {
  const tag = extractTag(text);
  if (tag) {
    const a = await db.query.asset.findFirst({
      where: and(eq(schema.asset.tag, tag), eq(schema.asset.tenantId, tid)),
    });
    if (a) return { type: "asset", id: a.id, label: `${a.tag} (${formatAssetModel(a)})` };

    const v = await db.query.vehicle.findFirst({
      where: and(eq(schema.vehicle.unit, tag), eq(schema.vehicle.tenantId, tid)),
    });
    if (v) return { type: "vehicle", id: v.id, label: v.unit };
  }

  const tokens = searchTokens(text);
  for (const token of tokens) {
    if (token.length < 2) continue;
    const emp = await db.query.employee.findFirst({
      where: and(
        eq(schema.employee.tenantId, tid),
        or(ilike(schema.employee.name, `%${token}%`), ilike(schema.employee.externalId, token)),
      ),
    });
    if (emp) return { type: "employee", id: emp.id, label: `${emp.name} #${emp.externalId ?? ""}` };

    const proj = await db.query.project.findFirst({
      where: and(eq(schema.project.tenantId, tid), ilike(schema.project.name, `%${token}%`)),
    });
    if (proj) return { type: "project", id: proj.id, label: proj.name };

    const loc = await db.query.location.findFirst({
      where: and(eq(schema.location.tenantId, tid), ilike(schema.location.name, `%${token}%`)),
    });
    if (loc) return { type: "location", id: loc.id, label: loc.name };

    /* A token can hit any of the three columns — "the Bosch" should match on
       brand, which a single ilike against the old blob could not. */
    const asset = await db.query.asset.findFirst({
      where: and(
        eq(schema.asset.tenantId, tid),
        or(
          ilike(schema.asset.make, `%${token}%`),
          ilike(schema.asset.modelNumber, `%${token}%`),
          ilike(schema.asset.description, `%${token}%`),
        ),
      ),
    });
    if (asset) return { type: "asset", id: asset.id, label: `${asset.tag} (${formatAssetModel(asset)})` };
  }
  return null;
}

// Resolve multiple assets from engine entity hints. Returns IDs for all that match.
export async function resolveEngineAssets(
  db: Database,
  tid: string,
  hints: { label: string; raw: string }[],
): Promise<{ id: string; label: string; tag: string | null }[]> {
  const results: { id: string; label: string; tag: string | null }[] = [];
  for (const h of hints) {
    const m = await matchEntity(db, tid, `${h.label} ${h.raw}`);
    if (m && m.type === "asset") {
      const a = await db.query.asset.findFirst({
        where: and(eq(schema.asset.id, m.id), eq(schema.asset.tenantId, tid)),
      });
      if (a) results.push({ id: a.id, label: m.label, tag: a.tag });
    }
  }
  return results;
}

// Resolve a custodian/employee hint. Filters to active custodians — foremen
// and mechanics; a mechanic named in a chat message failing to resolve was the
// whole feature silently dead for the shop until the role list stopped being a
// hardcoded "foreman".
export async function resolveCustodian(
  db: Database,
  tid: string,
  text: string,
): Promise<{ id: string; name: string } | null> {
  const tokens = searchTokens(text);
  for (const token of tokens) {
    if (token.length < 2) continue;
    const emp = await db.query.employee.findFirst({
      where: and(
        eq(schema.employee.tenantId, tid),
        inArray(schema.employee.role, [...CUSTODIAN_ROLES]),
        eq(schema.employee.employmentStatus, "active"),
        or(ilike(schema.employee.name, `%${token}%`), ilike(schema.employee.externalId, token)),
      ),
    });
    if (emp) return { id: emp.id, name: emp.name };
  }
  return null;
}

// Resolve project hint.
export async function resolveProject(
  db: Database,
  tid: string,
  text: string,
): Promise<{ id: string; name: string } | null> {
  const tokens = searchTokens(text);
  for (const token of tokens) {
    if (token.length < 2) continue;
    const proj = await db.query.project.findFirst({
      where: and(eq(schema.project.tenantId, tid), ilike(schema.project.name, `%${token}%`)),
    });
    if (proj) return { id: proj.id, name: proj.name };
  }
  return null;
}

// Resolve location hint.
export async function resolveLocation(
  db: Database,
  tid: string,
  text: string,
): Promise<{ id: string; name: string } | null> {
  const tokens = searchTokens(text);
  for (const token of tokens) {
    if (token.length < 2) continue;
    const loc = await db.query.location.findFirst({
      where: and(eq(schema.location.tenantId, tid), ilike(schema.location.name, `%${token}%`)),
    });
    if (loc) return { id: loc.id, name: loc.name };
  }
  return null;
}

// Resolve engine destination hint (can be employee, location, or project).
export async function resolveDestination(
  db: Database,
  tid: string,
  dest: { kind: string; raw: string } | null,
): Promise<{ id: string; label: string; kind: string } | null> {
  if (!dest) return null;
  if (dest.kind === "employee") {
    const emp = await resolveCustodian(db, tid, dest.raw);
    if (emp) return { id: emp.id, label: emp.name, kind: "employee" };
  }
  if (dest.kind === "location") {
    const loc = await resolveLocation(db, tid, dest.raw);
    if (loc) return { id: loc.id, label: loc.name, kind: "location" };
  }
  if (dest.kind === "project") {
    const proj = await resolveProject(db, tid, dest.raw);
    if (proj) return { id: proj.id, label: proj.name, kind: "project" };
  }
  // Fallback: try matching as any entity type.
  const m = await matchEntity(db, tid, dest.raw);
  if (m) return { id: m.id, label: m.label, kind: m.type };
  return null;
}
