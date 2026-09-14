import type { Database } from "@optix/db";
import * as schema from "@optix/db/schema";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { CUSTODIAN_ROLES, formatAssetModel } from "@optix/types";

export type EntityMatch = { type: "asset" | "employee" | "project" | "vehicle" | "location"; id: string; label: string };

/*
  Pull a CODE out of a sentence a foreman typed.

  This used to hardcode `UIC-`: a bare number became `UIC-1012`, and vehicles
  only matched `TRA-`/`TRU-`. Both were wrong about the real data. `UIC` was a
  placeholder that appeared in no row anywhere (it was a guess at "Urban
  InfraConstruction"), and Urban's actual fleet is `TRK-` ×47, `TE-` ×39 and
  `SUV-` ×2 — so "where is TRK-034" resolved to nothing while "where is
  TRA-034" resolved to a truck that does not exist.

  Now prefix-agnostic: it takes any `LETTERS-DIGITS` code as written, whatever
  the prefix, which is what makes a new one (`SKT-` for skytrack) work without
  a deploy. A BARE number is returned bare and matched against the code column
  by suffix rather than being decorated with a prefix nobody chose.
*/
export function extractTag(text: string): string | null {
  /*
    A written code: TRK-034, TE-006, TOOL-00012, SKT-1.

    The DASH IS REQUIRED, and that is not cosmetic. Allowing an optional space
    instead matched "need 2 grinders" as `NEED-2` — a test caught it. Any
    sentence ending in a word then a number would have become a code, which is
    most sentences a foreman types.

    A space-separated form ("TRK 034") is accepted only where the letters are
    ALL CAPS, because that is somebody writing a code loosely rather than
    writing prose. Two or more letters so "a-1" does not qualify.
  */
  const dashed = text.match(/\b([A-Za-z]{2,}-\d{1,6})\b/);
  if (dashed) return dashed[1]!.toUpperCase();
  const spaced = text.match(/\b([A-Z]{2,}) (\d{1,6})\b/);
  if (spaced) return `${spaced[1]!}-${spaced[2]!}`;
  /* A bare number — "where is 1012". Returned as digits: the caller matches it
     against the end of a code, so it finds TOOL-01012 without inventing a
     prefix. */
  const bare = text.match(/\b(\d{3,6})\b/);
  return bare ? bare[1]! : null;
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
    /*
      A written code matches exactly; a BARE number matches the end of a code.

      `extractTag` returns digits alone for "where is 1012" rather than
      decorating them with a prefix — so the match has to be a suffix one, and
      `-` is included so `1012` finds `TOOL-01012` without also finding
      `TOOL-41012`. Case-insensitive because a code's case is not its identity
      (the unique index is on `lower(code)`).
    */
    const bare = /^\d+$/.test(tag);
    const codeMatch = (col: AnyPgColumn) =>
      bare ? ilike(col, `%-%${tag}`) : ilike(col, tag);

    const a = await db.query.asset.findFirst({
      where: and(codeMatch(schema.asset.code), eq(schema.asset.tenantId, tid)),
    });
    if (a) return { type: "asset", id: a.id, label: `${a.code} (${formatAssetModel(a)})` };

    const v = await db.query.vehicle.findFirst({
      where: and(codeMatch(schema.vehicle.unit), eq(schema.vehicle.tenantId, tid)),
    });
    if (v) return { type: "vehicle", id: v.id, label: v.unit };
  }

  const tokens = searchTokens(text);
  for (const token of tokens) {
    if (token.length < 2) continue;
    const emp = await db.query.employee.findFirst({
      where: and(
        eq(schema.employee.tenantId, tid),
        or(ilike(schema.employee.name, `%${token}%`), ilike(schema.employee.code, token)),
      ),
    });
    if (emp) return { type: "employee", id: emp.id, label: `${emp.name} #${emp.code ?? ""}` };

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
    if (asset) return { type: "asset", id: asset.id, label: `${asset.code} (${formatAssetModel(asset)})` };
  }
  return null;
}

// Resolve multiple assets from engine entity hints. Returns IDs for all that match.
export async function resolveEngineAssets(
  db: Database,
  tid: string,
  hints: { label: string; raw: string }[],
): Promise<{ id: string; label: string; code: string | null }[]> {
  const results: { id: string; label: string; code: string | null }[] = [];
  for (const h of hints) {
    const m = await matchEntity(db, tid, `${h.label} ${h.raw}`);
    if (m && m.type === "asset") {
      const a = await db.query.asset.findFirst({
        where: and(eq(schema.asset.id, m.id), eq(schema.asset.tenantId, tid)),
      });
      if (a) results.push({ id: a.id, label: m.label, code: a.code });
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
    /*
      `role.can_hold_custody` first, the legacy name list second.

      The flag is the editable answer — an administrator ticking the box on
      /settings/roles is how a tenant says a Field Engineer carries tools — and
      `CUSTODIAN_ROLES` is kept only for rows with no login role joined, where
      the flag has nothing to say. The web pickers make the same choice in the
      same order (`apps/web/lib/custodians.ts`); if these two ever disagree the
      assistant and the screens resolve different people for one sentence,
      which is the bug class this whole change exists to close.
    */
    const [emp] = await db
      .select({ id: schema.employee.id, name: schema.employee.name })
      .from(schema.employee)
      .leftJoin(schema.role, eq(schema.role.id, schema.employee.roleId))
      .where(
        and(
          eq(schema.employee.tenantId, tid),
          or(
            eq(schema.role.canHoldCustody, true),
            and(isNull(schema.employee.roleId), inArray(schema.employee.role, [...CUSTODIAN_ROLES])),
          ),
          eq(schema.employee.employmentStatus, "active"),
          or(ilike(schema.employee.name, `%${token}%`), ilike(schema.employee.code, token)),
        ),
      )
      .limit(1);
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
