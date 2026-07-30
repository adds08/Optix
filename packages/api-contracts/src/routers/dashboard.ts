import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { byMostOverdue } from "@stinventory/domain";
import { protectedProcedure, router } from "../trpc.js";

export const dashboardRouter = router({
  kpis: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;

    const byStatus = (status: string) =>
      ctx.db
        .select({ c: count() })
        .from(schema.asset)
        .where(sql`${schema.asset.tenantId} = ${tid} AND ${schema.asset.currentStatus} = ${status}`)
        .then((r) => Number(r[0]?.c ?? 0));

    const [available, assigned, inMaintenance, lost, reserved] = await Promise.all([
      byStatus("available"),
      byStatus("assigned"),
      byStatus("in_maintenance"),
      byStatus("lost"),
      byStatus("reserved"),
    ]);

    const fleetValue = await ctx.db
      .select({ total: sql<string>`coalesce(sum(${schema.asset.acquisitionCost}::numeric),0)` })
      .from(schema.asset)
      .where(eq(schema.asset.tenantId, tid))
      .then((r) => r[0]?.total ?? "0");

    const terminated = await ctx.db
      .select({ id: schema.employee.id, name: schema.employee.name })
      .from(schema.employee)
      .where(sql`${schema.employee.tenantId} = ${tid} AND ${schema.employee.employmentStatus} = 'terminated'`);

    const termIds = terminated.map((t) => t.id);
    let clearanceCount = 0;
    if (termIds.length > 0) {
      clearanceCount = await ctx.db
        .select({ c: count() })
        .from(schema.asset)
        .where(
          sql`${schema.asset.tenantId} = ${tid} AND ${schema.asset.currentStatus} != 'available' AND ${schema.asset.currentCustodianId} IN (${sql.join(
            termIds.map((id) => sql`${id}`),
            sql`,`,
          )})`,
        )
        .then((r) => Number(r[0]?.c ?? 0));
    }

    return {
      available,
      assigned,
      inMaintenance,
      lost,
      reserved,
      scheduledMaint: 0,
      fleetValue,
      clearanceCount,
      terminatedCount: terminated.length,
    };
  }),

  overdueLoans: protectedProcedure
    .input(z.object({ employeeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const scopedEmployeeId =
        input?.employeeId ?? (ctx.session.roleName === "foreman" ? ctx.session.employeeId : undefined);
      const conditions = [eq(schema.assignment.tenantId, tid)];
      if (scopedEmployeeId) conditions.push(eq(schema.assignment.custodianId, scopedEmployeeId));
      const rows = await ctx.db
        .select({
          id: schema.assignment.id,
          assetId: schema.assignment.assetId,
          tag: schema.asset.tag,
          modelName: schema.asset.modelName,
          custodianId: schema.assignment.custodianId,
          custodianName: schema.employee.name,
          custodianExternalId: schema.employee.externalId,
          type: schema.assignment.type,
          status: schema.assignment.status,
          expectedEnd: schema.assignment.expectedEndDate,
        })
        .from(schema.assignment)
        .innerJoin(schema.asset, eq(schema.assignment.assetId, schema.asset.id))
        .innerJoin(schema.employee, eq(schema.assignment.custodianId, schema.employee.id))
        .where(and(...conditions));

    const today = new Date().toISOString().slice(0, 10);
    return rows
      .filter((r) => r.type === "temporary" && r.status === "active" && r.expectedEnd && r.expectedEnd < today)
      .map((r) => ({
        id: r.id,
        assetId: r.assetId,
        tag: r.tag,
        modelName: r.modelName,
        /* Needed by the caller to tell "you are holding this" from "somebody
           else is", which decides what the alert can sensibly ask for. */
        custodianId: r.custodianId,
        custodianName: r.custodianName,
        custodianExternalId: r.custodianExternalId,
        expectedEnd: r.expectedEnd,
        daysOverdue: Math.round((new Date(today).getTime() - new Date(r.expectedEnd!).getTime()) / 86400000),
      }))
      .sort(byMostOverdue);
  }),

  recentActivity: protectedProcedure
    .input(z.object({ employeeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const scopedEmployeeId =
        input?.employeeId ?? (ctx.session.roleName === "foreman" ? ctx.session.employeeId : undefined);
      const conditions = [eq(schema.transaction.tenantId, tid)];
      if (scopedEmployeeId) conditions.push(eq(schema.asset.currentCustodianId, scopedEmployeeId));
      return ctx.db
        .select({
          id: schema.transaction.id,
          eventType: schema.transaction.eventType,
          occurredAt: schema.transaction.occurredAt,
          note: schema.transaction.note,
          assetTag: schema.asset.tag,
          assetModel: schema.asset.modelName,
        })
        .from(schema.transaction)
        .innerJoin(schema.asset, eq(schema.transaction.assetId, schema.asset.id))
        .where(and(...conditions))
        .orderBy(sql`${schema.transaction.occurredAt} DESC`)
        .limit(20);
    }),

  clearanceQueue: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const term = await ctx.db
      .select({ id: schema.employee.id, name: schema.employee.name })
      .from(schema.employee)
      .where(sql`${schema.employee.tenantId} = ${tid} AND ${schema.employee.employmentStatus} = 'terminated'`);
    if (term.length === 0) return [];
    const termIds = term.map((t) => t.id);
    return ctx.db
      .select({
        tag: schema.asset.tag,
        modelName: schema.asset.modelName,
        status: schema.asset.currentStatus,
        cost: schema.asset.acquisitionCost,
        custodianName: schema.employee.name,
      })
      .from(schema.asset)
      .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
      .where(
        sql`${schema.asset.tenantId} = ${tid} AND ${schema.asset.currentStatus} != 'available' AND ${schema.asset.currentCustodianId} IN (${sql.join(
          termIds.map((id) => sql`${id}`),
          sql`,`,
        )})`,
      );
  }),

  pendingApprovals: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const pendingAssignments = await ctx.db
      .select({
        id: schema.assignment.id,
        type: sql<string>`'assignment'`,
        assetTag: schema.asset.tag,
        assetModel: schema.asset.modelName,
        custodianName: schema.employee.name,
        createdAt: schema.assignment.createdAt,
      })
      .from(schema.assignment)
      .innerJoin(schema.asset, eq(schema.assignment.assetId, schema.asset.id))
      .innerJoin(schema.employee, eq(schema.assignment.custodianId, schema.employee.id))
      .where(and(eq(schema.assignment.tenantId, tid), eq(schema.assignment.status, "pending_approval")));
    const pendingTransfers = await ctx.db
      .select({
        id: schema.transfer.id,
        type: sql<string>`'transfer'`,
        assetTag: schema.asset.tag,
        assetModel: schema.asset.modelName,
        custodianName: schema.employee.name,
        createdAt: schema.transfer.createdAt,
      })
      .from(schema.transfer)
      .innerJoin(schema.asset, eq(schema.transfer.assetId, schema.asset.id))
      .innerJoin(schema.employee, eq(schema.transfer.toCustodianId, schema.employee.id))
      .where(and(eq(schema.transfer.tenantId, tid), eq(schema.transfer.status, "pending_approval")));
    return [...pendingAssignments, ...pendingTransfers].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }),
});
