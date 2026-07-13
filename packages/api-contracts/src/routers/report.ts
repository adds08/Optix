import { alias } from "drizzle-orm/pg-core";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, router } from "../trpc.js";

export const reportRouter = router({
  assetRegister: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const currentProject = alias(schema.project, "current_project");
    const owningProject = alias(schema.project, "owning_project");
    return ctx.db
      .select({
        id: schema.asset.id,
        tag: schema.asset.tag,
        modelName: schema.asset.modelName,
        categoryName: schema.asset.categoryName,
        serialNumber: schema.asset.serialNumber,
        status: schema.asset.currentStatus,
        condition: schema.asset.condition,
        acquisitionCost: schema.asset.acquisitionCost,
        custodianName: schema.employee.name,
        currentProjectName: currentProject.name,
        locationName: schema.location.name,
        owningProjectName: owningProject.name,
      })
      .from(schema.asset)
      .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
      .leftJoin(currentProject, eq(schema.asset.currentProjectId, currentProject.id))
      .leftJoin(schema.location, eq(schema.asset.currentLocationId, schema.location.id))
      .leftJoin(owningProject, eq(schema.asset.owningProjectId, owningProject.id))
      .where(eq(schema.asset.tenantId, tid));
  }),

  byProject: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    return ctx.db
      .select({
        projectId: schema.project.id,
        projectName: schema.project.name,
        assetCount: sql<number>`count(${schema.asset.id})`,
        totalValue: sql<string>`coalesce(sum(${schema.asset.acquisitionCost}::numeric),0)`,
      })
      .from(schema.project)
      .leftJoin(schema.asset, and(eq(schema.asset.currentProjectId, schema.project.id), eq(schema.asset.tenantId, tid)))
      .where(eq(schema.project.tenantId, tid))
      .groupBy(schema.project.id, schema.project.name);
  }),

  byForeman: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    return ctx.db
      .select({
        employeeId: schema.employee.id,
        foremanName: schema.employee.name,
        assetCount: sql<number>`count(${schema.asset.id})`,
        totalValue: sql<string>`coalesce(sum(${schema.asset.acquisitionCost}::numeric),0)`,
        projectCount: sql<number>`count(distinct ${schema.asset.currentProjectId})`,
      })
      .from(schema.employee)
      .leftJoin(schema.asset, and(eq(schema.asset.currentCustodianId, schema.employee.id), eq(schema.asset.tenantId, tid)))
      .where(and(eq(schema.employee.tenantId, tid), eq(schema.employee.role, "foreman")))
      .groupBy(schema.employee.id, schema.employee.name);
  }),

  idle: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        tag: schema.asset.tag,
        modelName: schema.asset.modelName,
        categoryName: schema.asset.categoryName,
        locationName: schema.location.name,
        acquisitionCost: schema.asset.acquisitionCost,
      })
      .from(schema.asset)
      .leftJoin(schema.location, eq(schema.asset.currentLocationId, schema.location.id))
      .where(and(eq(schema.asset.tenantId, ctx.session.tenantId), eq(schema.asset.currentStatus, "available")));
  }),

  lost: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        tag: schema.asset.tag,
        modelName: schema.asset.modelName,
        acquisitionCost: schema.asset.acquisitionCost,
        custodianName: schema.employee.name,
      })
      .from(schema.asset)
      .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
      .where(and(eq(schema.asset.tenantId, ctx.session.tenantId), eq(schema.asset.currentStatus, "lost")));
  }),

  capitalByProject: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    return ctx.db
      .select({
        projectId: schema.project.id,
        projectName: schema.project.name,
        assetCount: sql<number>`count(${schema.asset.id})`,
        capitalValue: sql<string>`coalesce(sum(${schema.asset.acquisitionCost}::numeric),0)`,
      })
      .from(schema.project)
      .leftJoin(schema.asset, and(eq(schema.asset.owningProjectId, schema.project.id), eq(schema.asset.tenantId, tid)))
      .where(eq(schema.project.tenantId, tid))
      .groupBy(schema.project.id, schema.project.name);
  }),
});
