import { alias } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

export const projectRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: schema.project.id,
        name: schema.project.name,
        externalId: schema.project.externalId,
        status: schema.project.status,
        costCenter: schema.project.costCenter,
        startDate: schema.project.startDate,
        endDate: schema.project.endDate,
      })
      .from(schema.project)
      .where(eq(schema.project.tenantId, ctx.session.tenantId));
  }),

  create: requirePermission("project.manage")
    .input(
      z.object({
        name: z.string().min(1).max(200),
        externalId: z.string().optional(),
        status: z.string().optional(),
        costCenter: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.project)
        .values({ tenantId: ctx.session.tenantId, ...input })
        .returning();
      if (row) await logEvent(ctx, { category: "project", action: "create", entityType: "project", entityId: row.id, entityLabel: row.name });
      return row;
    }),
});

export const employeeRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const reportsTo = alias(schema.employee, "reports_to");
    return ctx.db
      .select({
        id: schema.employee.id,
        externalId: schema.employee.externalId,
        name: schema.employee.name,
        role: schema.employee.role,
        email: schema.employee.email,
        phone: schema.employee.phone,
        employmentStatus: schema.employee.employmentStatus,
        terminatedAt: schema.employee.terminatedAt,
        primaryProjectId: schema.employee.primaryProjectId,
        primaryProjectName: schema.project.name,
        reportsToEmployeeId: schema.employee.reportsToEmployeeId,
        reportsToName: reportsTo.name,
      })
      .from(schema.employee)
      .leftJoin(schema.project, eq(schema.employee.primaryProjectId, schema.project.id))
      .leftJoin(reportsTo, eq(schema.employee.reportsToEmployeeId, reportsTo.id))
      .where(eq(schema.employee.tenantId, ctx.session.tenantId));
  }),

  create: requirePermission("employee.manage")
    .input(
      z.object({
        name: z.string().min(1).max(200),
        role: z.string().default("foreman"),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        primaryProjectId: z.string().uuid().optional(),
        externalId: z.string().optional(),
        employmentStatus: z.string().optional(),
        reportsToEmployeeId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.employee)
        .values({ tenantId: ctx.session.tenantId, ...input })
        .returning();
      return row;
    }),

  myForemen: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.session.employeeId) return [];
    return ctx.db
      .select({
        id: schema.employee.id,
        externalId: schema.employee.externalId,
        name: schema.employee.name,
        role: schema.employee.role,
        email: schema.employee.email,
        phone: schema.employee.phone,
        employmentStatus: schema.employee.employmentStatus,
        primaryProjectId: schema.employee.primaryProjectId,
      })
      .from(schema.employee)
      .where(
        and(
          eq(schema.employee.tenantId, ctx.session.tenantId),
          eq(schema.employee.reportsToEmployeeId, ctx.session.employeeId),
          eq(schema.employee.employmentStatus, "active"),
        ),
      );
  }),
});
