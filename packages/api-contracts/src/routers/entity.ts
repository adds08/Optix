import { and, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
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
            subtitle: schema.asset.modelName,
          })
          .from(schema.asset)
          .where(
            and(
              eq(schema.asset.tenantId, tid),
              or(
                ilike(schema.asset.tag, q),
                ilike(schema.asset.modelName, q),
                ilike(schema.asset.serialNumber, q),
              ),
            ),
          )
          .limit(limit);
        return rows.map((r) => ({ id: r.id, label: r.label, subtitle: r.subtitle }));
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
});
