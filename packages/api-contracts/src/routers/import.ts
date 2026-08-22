import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import {
  IMPORT_SPECS,
  formatAssetModel,
  type ImportColumn,
  type ImportEntity,
  type ImportRefTarget,
  type ImportSpec,
} from "@stinventory/types";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc.js";
import { logEvent } from "../audit.js";

/*
  Bulk CSV import.

  Two procedures over one validator. `preview` is a dry run that tells the user
  exactly which rows are wrong and why; `commit` re-runs the same checks server
  side and writes everything inside a single transaction.

  All-or-nothing on purpose. A tool register is a system of record — a partially
  applied import leaves nobody able to say whether a missing tool was never
  imported or actually lost, and that ambiguity is the thing the register exists
  to prevent. Fix the spreadsheet, run it again.

  The client never gets to say a row is valid. It runs the same spec for instant
  feedback, but `commit` trusts none of it.
*/

const ENTITIES = ["asset", "employee", "project", "location", "vehicle"] as const;

export type RowError = { column: string; message: string };

export type PreviewRow = {
  index: number;
  values: Record<string, string>;
  resolved: Record<string, unknown>;
  errors: RowError[];
};

/* Every name→id lookup for one import, loaded once. A 400-row file would
   otherwise issue 400 queries per ref column. */
export type RefIndex = Record<ImportRefTarget, Map<string, string>>;

async function loadRefIndex(db: any, tenantId: string): Promise<RefIndex> {
  const [projects, locations, employees, warehouses] = await Promise.all([
    db.select({ id: schema.project.id, name: schema.project.name })
      .from(schema.project).where(eq(schema.project.tenantId, tenantId)),
    db.select({ id: schema.location.id, name: schema.location.name })
      .from(schema.location).where(eq(schema.location.tenantId, tenantId)),
    db.select({ id: schema.employee.id, name: schema.employee.name })
      .from(schema.employee).where(eq(schema.employee.tenantId, tenantId)),
    db.select({ id: schema.warehouse.id, name: schema.warehouse.name })
      .from(schema.warehouse).where(eq(schema.warehouse.tenantId, tenantId)),
  ]);

  const toMap = (rows: { id: string; name: string }[]) =>
    new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));

  return {
    project: toMap(projects),
    location: toMap(locations),
    employee: toMap(employees),
    warehouse: toMap(warehouses),
  };
}

/* Existing values for the spec's unique columns, so a duplicate is caught
   before insert rather than as a constraint error halfway through. */
async function loadExisting(db: any, tenantId: string, spec: ImportSpec): Promise<Record<string, Set<string>>> {
  const out: Record<string, Set<string>> = {};
  for (const key of spec.unique) out[key] = new Set<string>();

  if (spec.entity === "asset" && spec.unique.length) {
    const rows = await db
      .select({ tag: schema.asset.tag, serialNumber: schema.asset.serialNumber })
      .from(schema.asset)
      .where(eq(schema.asset.tenantId, tenantId));
    for (const r of rows) {
      if (r.tag) out.tag?.add(String(r.tag).toLowerCase());
      if (r.serialNumber) out.serialNumber?.add(String(r.serialNumber).toLowerCase());
    }
  }
  if (spec.entity === "employee") {
    const rows = await db.select({ externalId: schema.employee.externalId })
      .from(schema.employee).where(eq(schema.employee.tenantId, tenantId));
    for (const r of rows) if (r.externalId) out.externalId?.add(String(r.externalId).toLowerCase());
  }
  if (spec.entity === "project") {
    const rows = await db.select({ externalId: schema.project.externalId })
      .from(schema.project).where(eq(schema.project.tenantId, tenantId));
    for (const r of rows) if (r.externalId) out.externalId?.add(String(r.externalId).toLowerCase());
  }
  if (spec.entity === "vehicle") {
    const rows = await db.select({ unit: schema.vehicle.unit })
      .from(schema.vehicle).where(eq(schema.vehicle.tenantId, tenantId));
    for (const r of rows) if (r.unit) out.unit?.add(String(r.unit).toLowerCase());
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* Exported for `import-validation.test.ts` (STI-405). Both are pure — no
   database, no session — which is exactly why they are worth testing directly:
   `SYSTEM_PLAN.md` §5 called the importer "genuinely good: typed validation,
   dedup, preview, transactional commit" and then "No tests", and the typed
   validation is the half a bad spreadsheet meets first. */
export function checkCell(col: ImportColumn, raw: string, refs: RefIndex): { value?: unknown; error?: string } {
  const v = raw.trim();

  if (!v) {
    if (col.required) return { error: "required" };
    return { value: undefined };
  }

  switch (col.type) {
    case "integer": {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return { error: "must be a whole number of 1 or more" };
      return { value: n };
    }
    case "decimal": {
      if (!/^\d+(\.\d{1,2})?$/.test(v)) return { error: "must be a number like 489.00" };
      return { value: v };
    }
    case "date": {
      if (!DATE_RE.test(v)) return { error: "must be a date like 2026-03-14" };
      if (Number.isNaN(Date.parse(v))) return { error: "not a real date" };
      return { value: v };
    }
    /* Vendor portals export MM/DD/YYYY. Normalised here rather than asking a
       yard clerk to reformat a column before the file will load. */
    case "usdate": {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
      if (!m) return { error: "must be a date like 12/04/2026" };
      const [, mm, dd, yyyy] = m;
      const iso = `${yyyy}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`;
      if (Number.isNaN(Date.parse(iso))) return { error: "not a real date" };
      return { value: iso };
    }
    case "enum": {
      /* The yard's own vocabulary is folded onto ours before matching — a
         trailer sheet says USED where the register means good, and widening
         ASSET_CONDITIONS to carry "used" would make it a distinct condition
         nothing downstream knows the meaning of. Keys are lowercase. */
      const lower = col.valueAliases?.[v.toLowerCase()] ?? v.toLowerCase();
      const match = col.values?.find((o) => o.toLowerCase() === lower);
      if (!match) return { error: `must be one of: ${col.values?.join(", ")}` };
      return { value: match };
    }
    case "ref": {
      const id = refs[col.ref!].get(v.toLowerCase());
      if (!id) return { error: `no ${col.ref} named "${v}"` };
      return { value: id };
    }
    default:
      return { value: v };
  }
}

export function validateRows(
  spec: ImportSpec,
  rows: Record<string, string>[],
  refs: RefIndex,
  existing: Record<string, Set<string>>,
): PreviewRow[] {
  /* Duplicates within the file matter as much as duplicates against the DB —
     two rows claiming UIC-2001 is a bad spreadsheet either way. */
  const seen: Record<string, Map<string, number>> = {};
  for (const key of spec.unique) seen[key] = new Map();

  return rows.map((row, index) => {
    const errors: RowError[] = [];
    const resolved: Record<string, unknown> = {};

    for (const col of spec.columns) {
      const { value, error } = checkCell(col, row[col.header] ?? "", refs);
      if (error) errors.push({ column: col.header, message: error });
      else if (value !== undefined) resolved[col.key] = value;
    }

    for (const key of spec.unique) {
      const col = spec.columns.find((c) => c.key === key);
      const val = resolved[key];
      if (!col || typeof val !== "string" || !val) continue;
      const norm = val.toLowerCase();

      if (existing[key]?.has(norm)) {
        errors.push({ column: col.header, message: `"${val}" already exists` });
      }
      const firstRow = seen[key]?.get(norm);
      if (firstRow !== undefined) {
        /* +2 so this matches the row number the user sees: index is 0-based and
           the file's first line is the header. */
        errors.push({ column: col.header, message: `same as row ${firstRow + 2}` });
      } else {
        seen[key]?.set(norm, index);
      }
    }

    return { index, values: row, resolved, errors };
  });
}

async function prepare(db: any, tenantId: string, entity: ImportEntity, rows: Record<string, string>[]) {
  const spec = IMPORT_SPECS[entity];
  const [refs, existing] = await Promise.all([
    loadRefIndex(db, tenantId),
    loadExisting(db, tenantId, spec),
  ]);
  const previewed = validateRows(spec, rows, refs, existing);
  return { spec, rows: previewed };
}

function requirePerm(session: { permissions: ReadonlySet<any> }, spec: ImportSpec) {
  if (!session.permissions.has(spec.permission)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Importing ${spec.label.toLowerCase()} requires ${spec.permission}`,
    });
  }
}

const inputShape = z.object({
  entity: z.enum(ENTITIES),
  rows: z.array(z.record(z.string(), z.string())).min(1).max(5000),
});

export const importRouter = router({
  /*
    A mutation despite changing nothing.

    tRPC puts query input in the URL, and a real import is tens of kilobytes —
    137 rows of a vendor export is 39KB, which the server rejects with 431
    before any of this runs. Preview was therefore broken for every file large
    enough to be worth previewing, on every entity. Mutations POST their input
    in the body, which is the only thing that makes the size workable.

    It remains read-only: nothing here writes.
  */
  preview: protectedProcedure.input(inputShape).mutation(async ({ ctx, input }) => {
    const spec = IMPORT_SPECS[input.entity as ImportEntity];
    requirePerm(ctx.session, spec);

    const { rows } = await prepare(ctx.db, ctx.session.tenantId, input.entity as ImportEntity, input.rows);
    const badRows = rows.filter((r) => r.errors.length);

    return {
      entity: input.entity,
      rows,
      summary: { total: rows.length, ok: rows.length - badRows.length, bad: badRows.length },
    };
  }),

  commit: protectedProcedure.input(inputShape).mutation(async ({ ctx, input }) => {
    const entity = input.entity as ImportEntity;
    const spec = IMPORT_SPECS[entity];
    requirePerm(ctx.session, spec);

    const tid = ctx.session.tenantId;
    const { rows } = await prepare(ctx.db, tid, entity, input.rows);

    const bad = rows.filter((r) => r.errors.length);
    if (bad.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${bad.length} of ${rows.length} rows are still invalid. Nothing was imported.`,
      });
    }

    const created = await ctx.db.transaction(async (tx: any) => {
      const ids: string[] = [];
      for (const row of rows) {
        const id = await insertOne(tx, tid, ctx.session.userId, entity, row.resolved);
        if (id) ids.push(id);
      }
      return ids;
    });

    await logEvent(ctx, {
      category:
        entity === "asset"
          ? "asset"
          : entity === "employee"
            ? "assignment"
            : "system",
      action: `import.${entity}`,
      entityType: entity,
      details: { count: created.length },
    });

    return { ok: true, imported: created.length, ids: created };
  }),
});

async function insertOne(
  tx: any,
  tenantId: string,
  actorUserId: string,
  entity: ImportEntity,
  values: Record<string, unknown>,
): Promise<string | null> {
  if (entity === "asset") {
    const label = formatAssetModel(values) || "Untagged tool";
    const [row] = await tx
      .insert(schema.asset)
      .values({
        tenantId,
        createdBy: actorUserId,
        currentStatus: "available",
        currentLocationId: (values.locationId as string) ?? null,
        ...values,
      })
      .returning();
    if (!row) return null;

    /* Same opening event asset.create writes. Without it an imported tool has a
       projection but no origin in the ledger, and the fold has nothing to
       rebuild from. */
    await tx.insert(schema.transaction).values({
      tenantId,
      assetId: row.id,
      eventType: "tag",
      actorId: actorUserId,
      toState: {
        status: "available",
        custodianId: null,
        projectId: null,
        locationId: (values.locationId as string) ?? null,
      },
      refType: "manual",
      note: `Asset ${label} imported`,
    });
    return row.id;
  }

  if (entity === "employee") {
    const [row] = await tx.insert(schema.employee).values({ tenantId, ...values }).returning();
    if (!row) return null;

    /* Mirrors employee.create: a person who arrives already posted to a job
       gets that posting recorded, so the history a spreadsheet import produces
       looks the same as one typed in. */
    if (values.primaryProjectId) {
      await tx.insert(schema.employeeProjectAssignment).values({
        tenantId,
        employeeId: row.id,
        projectId: values.primaryProjectId as string,
        startedOn: new Date().toISOString().slice(0, 10),
        assignedByUserId: actorUserId,
        note: "Initial posting (imported)",
      });
    }
    return row.id;
  }

  if (entity === "project") {
    const [row] = await tx.insert(schema.project).values({ tenantId, ...values }).returning();
    return row?.id ?? null;
  }

  if (entity === "location") {
    const [row] = await tx.insert(schema.location).values({ tenantId, ...values }).returning();
    return row?.id ?? null;
  }

  if (entity === "vehicle") {
    /* A vehicle is a location that moves, so the location row comes first —
       vehicle.locationId is NOT NULL. Mirrors vehicle.create. */
    const [loc] = await tx
      .insert(schema.location)
      .values({
        tenantId,
        type: "vehicle",
        name: values.unit as string,
        projectId: (values.projectId as string) ?? null,
        custodianEmployeeId: (values.foremanEmployeeId as string) ?? null,
      })
      .returning();
    if (!loc) return null;
    const [row] = await tx
      .insert(schema.vehicle)
      .values({ tenantId, locationId: loc.id, ...values })
      .returning();
    return row?.id ?? null;
  }

  return null;
}


