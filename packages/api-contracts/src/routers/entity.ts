import { and, eq, ilike, ne, or } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { formatAssetModel, type MentionKind } from "@stinventory/types";
import { protectedProcedure, router } from "../trpc.js";

export const entityRouter = router({
  // Typeahead suggestion: given kind + prefix, return ranked results.
  suggest: protectedProcedure
    .input(
      z.object({
        kind: z.enum(["asset", "employee", "project", "location", "vehicle"]),
        q: z.string().min(1).max(100),
        limit: z.number().min(1).max(20).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const q = `%${input.q.toLowerCase()}%`;
      const limit = input.limit;

      if (input.kind === "asset") {
        const rows = await ctx.db
          .select({
            id: schema.asset.id,
            label: schema.asset.tag,
            make: schema.asset.make,
            modelNumber: schema.asset.modelNumber,
            description: schema.asset.description,
          })
          .from(schema.asset)
          .where(
            and(
              eq(schema.asset.tenantId, tid),
              or(
                ilike(schema.asset.tag, q),
                ilike(schema.asset.make, q),
                ilike(schema.asset.modelNumber, q),
                ilike(schema.asset.description, q),
                ilike(schema.asset.serialNumber, q),
              ),
            ),
          )
          .limit(limit);
        return rows.map((r) => ({
          id: r.id,
          /* An untagged tool still needs a line in the picker — the id is the
             identity, so the row is named by whatever the tool is. */
          label: r.label ?? "Untagged tool",
          subtitle: formatAssetModel(r),
        }));
      }

      if (input.kind === "employee") {
        const rows = await ctx.db
          .select({
            id: schema.employee.id,
            label: schema.employee.name,
            subtitle: schema.employee.externalId,
          })
          .from(schema.employee)
          .where(
            and(
              eq(schema.employee.tenantId, tid),
              eq(schema.employee.employmentStatus, "active"),
              or(ilike(schema.employee.name, q), ilike(schema.employee.externalId, q)),
            ),
          )
          .limit(limit);
        return rows.map((r) => ({ id: r.id, label: r.label, subtitle: r.subtitle ? `#${r.subtitle}` : undefined }));
      }

      if (input.kind === "project") {
        const rows = await ctx.db
          .select({
            id: schema.project.id,
            label: schema.project.name,
            subtitle: schema.project.externalId,
          })
          .from(schema.project)
          .where(
            and(
              eq(schema.project.tenantId, tid),
              or(ilike(schema.project.name, q), ilike(schema.project.externalId, q)),
            ),
          )
          .limit(limit);
        return rows.map((r) => ({ id: r.id, label: r.label, subtitle: r.subtitle }));
      }

      if (input.kind === "location") {
        const rows = await ctx.db
          .select({
            id: schema.location.id,
            label: schema.location.name,
            subtitle: schema.location.type,
          })
          .from(schema.location)
          .where(and(eq(schema.location.tenantId, tid), ilike(schema.location.name, q)))
          .limit(limit);
        return rows.map((r) => ({ id: r.id, label: r.label, subtitle: ` (${r.subtitle})` }));
      }

      if (input.kind === "vehicle") {
        const rows = await ctx.db
          .select({
            id: schema.vehicle.id,
            label: schema.vehicle.unit,
            subtitle: schema.vehicle.makeModel,
          })
          .from(schema.vehicle)
          .where(
            and(
              eq(schema.vehicle.tenantId, tid),
              or(ilike(schema.vehicle.unit, q), ilike(schema.vehicle.makeModel, q)),
            ),
          )
          .limit(limit);
        return rows.map((r) => ({ id: r.id, label: r.label, subtitle: r.subtitle }));
      }

      return [];
    }),

  /*
    One search across everything a message can name.

    This is what `@` opens. A foreman types `@10` and does not know or care
    whether "10" is going to turn out to be a tool tag, a truck unit, an
    employee number or a job code — they type the fragment they remember and
    pick the row they recognise. Making them choose a category first would be
    the same mistake as making them remember a command.

    Ranked so the thing they meant is first: an exact code beats a prefix,
    which beats a match buried in the middle of a model name.
  */
  search: protectedProcedure
    .input(
      z.object({
        q: z.string().min(1).max(100),
        limit: z.number().min(1).max(30).default(12),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const raw = input.q.trim();
      const q = `%${raw.toLowerCase()}%`;

      const [assets, employees, projects, locations, vehicles] = await Promise.all([
        ctx.db
          .select({
            id: schema.asset.id,
            label: schema.asset.tag,
            make: schema.asset.make,
            modelNumber: schema.asset.modelNumber,
            description: schema.asset.description,
            status: schema.asset.currentStatus,
            custodianName: schema.employee.name,
          })
          .from(schema.asset)
          .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
          .where(
            and(
              eq(schema.asset.tenantId, tid),
              or(
                ilike(schema.asset.tag, q),
                ilike(schema.asset.make, q),
                ilike(schema.asset.modelNumber, q),
                ilike(schema.asset.description, q),
                ilike(schema.asset.serialNumber, q),
              ),
            ),
          )
          .limit(input.limit),

        ctx.db
          .select({
            id: schema.employee.id,
            label: schema.employee.name,
            subtitle: schema.employee.role,
            externalId: schema.employee.externalId,
          })
          .from(schema.employee)
          .where(
            and(
              eq(schema.employee.tenantId, tid),
              eq(schema.employee.employmentStatus, "active"),
              or(ilike(schema.employee.name, q), ilike(schema.employee.externalId, q)),
            ),
          )
          .limit(input.limit),

        ctx.db
          .select({
            id: schema.project.id,
            label: schema.project.name,
            subtitle: schema.project.externalId,
          })
          .from(schema.project)
          .where(
            and(
              eq(schema.project.tenantId, tid),
              or(ilike(schema.project.name, q), ilike(schema.project.externalId, q)),
            ),
          )
          .limit(input.limit),

        /* Vehicle locations are excluded here because the vehicle query below
           returns the same places with a better label ("TRU-012 · Ford F-250"
           rather than bare "Truck 12"). Listing both would show the yard two
           rows for one truck. */
        ctx.db
          .select({
            id: schema.location.id,
            label: schema.location.name,
            subtitle: schema.location.type,
          })
          .from(schema.location)
          .where(
            and(
              eq(schema.location.tenantId, tid),
              ne(schema.location.type, "vehicle"),
              ilike(schema.location.name, q),
            ),
          )
          .limit(input.limit),

        ctx.db
          .select({
            id: schema.vehicle.id,
            locationId: schema.vehicle.locationId,
            label: schema.vehicle.unit,
            subtitle: schema.vehicle.makeModel,
            vehicleType: schema.vehicle.vehicleType,
          })
          .from(schema.vehicle)
          .where(
            and(
              eq(schema.vehicle.tenantId, tid),
              or(ilike(schema.vehicle.unit, q), ilike(schema.vehicle.makeModel, q), ilike(schema.vehicle.plate, q)),
            ),
          )
          .limit(input.limit),
      ]);

      type Hit = {
        kind: MentionKind;
        id: string;
        label: string;
        subtitle?: string;
        /** Vehicles carry the location row tools actually ride in. */
        locationId?: string;
      };

      const hits: Hit[] = [
        ...assets.map((a: any) => ({
          kind: "asset" as const,
          id: a.id,
          label: a.label,
          /* Who has it right now is the thing that decides whether this is the
             row they meant, so it goes in the line they can see. */
          subtitle: [formatAssetModel(a), a.custodianName ? `with ${a.custodianName}` : humanStatus(a.status)]
            .filter(Boolean)
            .join(" · "),
        })),
        ...employees.map((e: any) => ({
          kind: "employee" as const,
          id: e.id,
          label: e.label,
          subtitle: [e.subtitle?.replace(/_/g, " "), e.externalId ? `#${e.externalId}` : null]
            .filter(Boolean)
            .join(" · "),
        })),
        ...projects.map((p: any) => ({
          kind: "project" as const,
          id: p.id,
          label: p.label,
          subtitle: p.subtitle ?? undefined,
        })),
        ...locations.map((l: any) => ({
          kind: "location" as const,
          id: l.id,
          label: l.label,
          subtitle: String(l.subtitle ?? "").replace(/_/g, " "),
        })),
        ...vehicles.map((v: any) => ({
          kind: "vehicle" as const,
          id: v.id,
          label: v.label,
          subtitle: [v.vehicleType, v.subtitle].filter(Boolean).join(" · "),
          locationId: v.locationId,
        })),
      ];

      hits.sort((a, b) => rank(a.label, raw) - rank(b.label, raw) || a.label.localeCompare(b.label));
      return hits.slice(0, input.limit);
    }),
});

/* Exact code first, then things that start with what was typed, then the rest.
   Somebody typing a full tag wants that tag at the top, not alphabetically
   third behind two model names that happen to contain the digits. */
function rank(label: string, query: string): number {
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  if (l === q) return 0;
  if (l.startsWith(q)) return 1;
  return 2;
}

function humanStatus(status: string | null): string {
  if (!status) return "";
  return status === "available" ? "in the yard" : status.replace(/_/g, " ");
}
