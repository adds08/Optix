import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { assetVisibility, assetScopeWhere } from "../scope.js";
import { pageParamsSchema, type Paginated, type SortableMap, sortSql } from "../table-helpers.js";

/*
  STI-302 — every report on this router is now gated on `report.read` AND
  narrowed by the visibility ladder.

  Reports were the widest hole in the product. Each one was a bare
  `protectedProcedure` over the whole tenant, so any signed-in account could
  read the complete asset register, every foreman's holdings by name and value,
  and the capital totals per project and per department — the same facts the
  register screens were about to start withholding. A control that the export
  button walks around is not a control.

  The aggregate reports (`byProject`, `byForeman`, `byMechanic`,
  `capitalByProject`, `capitalByDepartment`) group over a LEFT JOIN, so the
  scope predicate belongs in the JOIN condition, not the WHERE. In the WHERE it
  would drop whole projects and people from the result; in the join it keeps
  the row and zeroes the number, which is the honest answer — "this job exists
  and you can see none of its tools" rather than "this job does not exist".
*/
export const reportRouter = router({
  /*
    Gated on `asset.read`, not `report.read` — this report IS the asset
    register, column for column, and routing it through the reports permission
    let HR (who holds `report.read` and deliberately NOT `asset.read`) read
    every tool Urban owns by name, serial and value. Found by probing all
    thirteen roles against the running API rather than by reading the matrix,
    which does not notice that two of its rows describe the same data.
  */
  assetRegister: requirePermission("asset.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
    const currentProject = alias(schema.project, "current_project");
    const owningProject = alias(schema.project, "owning_project");
    const owningDepartment = alias(schema.department, "owning_department");
    return ctx.db
      .select({
        id: schema.asset.id,
        tag: schema.asset.tag,
        make: schema.asset.make,
        modelNumber: schema.asset.modelNumber,
        description: schema.asset.description,
        otherRef: schema.asset.otherRef,
        categoryName: schema.asset.categoryName,
        serialNumber: schema.asset.serialNumber,
        status: schema.asset.currentStatus,
        condition: schema.asset.condition,
        acquisitionCost: schema.asset.acquisitionCost,
        custodianName: schema.employee.name,
        currentProjectName: currentProject.name,
        locationName: schema.location.name,
        owningProjectName: owningProject.name,
        owningDepartmentName: owningDepartment.name,
      })
      .from(schema.asset)
      .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
      .leftJoin(currentProject, eq(schema.asset.currentProjectId, currentProject.id))
      .leftJoin(schema.location, eq(schema.asset.currentLocationId, schema.location.id))
      .leftJoin(owningProject, eq(schema.asset.owningProjectId, owningProject.id))
      .leftJoin(owningDepartment, eq(schema.asset.owningDepartmentId, owningDepartment.id))
      .where(and(eq(schema.asset.tenantId, tid), scoped));
  }),

  byProject: requirePermission("report.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
    return ctx.db
      .select({
        projectId: schema.project.id,
        projectName: schema.project.name,
        assetCount: sql<number>`count(${schema.asset.id})`,
        totalValue: sql<string>`coalesce(sum(${schema.asset.acquisitionCost}::numeric),0)`,
      })
      .from(schema.project)
      .leftJoin(schema.asset, and(eq(schema.asset.currentProjectId, schema.project.id), eq(schema.asset.tenantId, tid), scoped))
      .where(eq(schema.project.tenantId, tid))
      .groupBy(schema.project.id, schema.project.name);
  }),

  byForeman: requirePermission("report.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
    return ctx.db
      .select({
        employeeId: schema.employee.id,
        foremanName: schema.employee.name,
        assetCount: sql<number>`count(${schema.asset.id})`,
        totalValue: sql<string>`coalesce(sum(${schema.asset.acquisitionCost}::numeric),0)`,
        projectCount: sql<number>`count(distinct ${schema.asset.currentProjectId})`,
      })
      .from(schema.employee)
      .leftJoin(schema.asset, and(eq(schema.asset.currentCustodianId, schema.employee.id), eq(schema.asset.tenantId, tid), scoped))
      .where(and(eq(schema.employee.tenantId, tid), eq(schema.employee.role, "foreman")))
      .groupBy(schema.employee.id, schema.employee.name);
  }),

  /* A copy of byForeman with the role filter changed, deliberately not a
     parameterised version of it. Parameterising would make a report whose
     meaning changes with a flag; two near-identical queries are cheaper to read
     and cheaper to be wrong about. */
  byMechanic: requirePermission("report.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
    return ctx.db
      .select({
        employeeId: schema.employee.id,
        mechanicName: schema.employee.name,
        assetCount: sql<number>`count(${schema.asset.id})`,
        totalValue: sql<string>`coalesce(sum(${schema.asset.acquisitionCost}::numeric),0)`,
      })
      .from(schema.employee)
      .leftJoin(schema.asset, and(eq(schema.asset.currentCustodianId, schema.employee.id), eq(schema.asset.tenantId, tid), scoped))
      .where(and(eq(schema.employee.tenantId, tid), eq(schema.employee.role, "mechanic")))
      .groupBy(schema.employee.id, schema.employee.name);
  }),

  idle: requirePermission("report.read").query(async ({ ctx }) => {
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
    return ctx.db
      .select({
        tag: schema.asset.tag,
        make: schema.asset.make,
        modelNumber: schema.asset.modelNumber,
        description: schema.asset.description,
        categoryName: schema.asset.categoryName,
        locationName: schema.location.name,
        acquisitionCost: schema.asset.acquisitionCost,
      })
      .from(schema.asset)
      .leftJoin(schema.location, eq(schema.asset.currentLocationId, schema.location.id))
      .where(and(eq(schema.asset.tenantId, ctx.session.tenantId), eq(schema.asset.currentStatus, "available"), scoped));
  }),

  lost: requirePermission("report.read").query(async ({ ctx }) => {
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
    return ctx.db
      .select({
        tag: schema.asset.tag,
        make: schema.asset.make,
        modelNumber: schema.asset.modelNumber,
        description: schema.asset.description,
        acquisitionCost: schema.asset.acquisitionCost,
        custodianName: schema.employee.name,
      })
      .from(schema.asset)
      .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
      .where(and(eq(schema.asset.tenantId, ctx.session.tenantId), eq(schema.asset.currentStatus, "lost"), scoped));
  }),

  /* Every tool nobody has labelled yet — the worklist for whoever is holding
     the label gun. A tag is optional and only exists once somebody makes one,
     so this is how the register can still produce the list of tools that need
     one. */
  needsTag: requirePermission("report.read").query(async ({ ctx }) => {
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
    return ctx.db
      .select({
        tag: schema.asset.tag,
        make: schema.asset.make,
        modelNumber: schema.asset.modelNumber,
        description: schema.asset.description,
        serialNumber: schema.asset.serialNumber,
        categoryName: schema.asset.categoryName,
        locationName: schema.location.name,
        acquisitionCost: schema.asset.acquisitionCost,
      })
      .from(schema.asset)
      .leftJoin(schema.location, eq(schema.asset.currentLocationId, schema.location.id))
      .where(
        and(
          eq(schema.asset.tenantId, ctx.session.tenantId),
          isNull(schema.asset.tag),
          scoped,
        ),
      );
  }),

  capitalByProject: requirePermission("report.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
    return ctx.db
      .select({
        projectId: schema.project.id,
        projectName: schema.project.name,
        assetCount: sql<number>`count(${schema.asset.id})`,
        capitalValue: sql<string>`coalesce(sum(${schema.asset.acquisitionCost}::numeric),0)`,
      })
      .from(schema.project)
      .leftJoin(schema.asset, and(eq(schema.asset.owningProjectId, schema.project.id), eq(schema.asset.tenantId, tid), scoped))
      .where(eq(schema.project.tenantId, tid))
      .groupBy(schema.project.id, schema.project.name);
  }),

  /* The other half of who pays for the fleet. A direct mirror of
     capitalByProject, grouping on the department that owns the shop tools —
     same shape, same sum, so the two reports read the same way. */
  capitalByDepartment: requirePermission("report.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
    return ctx.db
      .select({
        departmentId: schema.department.id,
        departmentName: schema.department.name,
        assetCount: sql<number>`count(${schema.asset.id})`,
        capitalValue: sql<string>`coalesce(sum(${schema.asset.acquisitionCost}::numeric),0)`,
      })
      .from(schema.department)
      .leftJoin(schema.asset, and(
        eq(schema.asset.owningDepartmentId, schema.department.id),
        eq(schema.asset.tenantId, tid),
        scoped,
      ))
      .where(eq(schema.department.tenantId, tid))
      .groupBy(schema.department.id, schema.department.name);
  }),

  /*
    The audit trail as a report — the one place "everything that happened"
    lives (docs/20, C1).

    The dashboard's movement strip and the old /activity page both read the
    same `transaction` rows; this page is the deep end of that single source,
    server-paginated and filterable. Sort keys are whitelisted — the ledger is
    append-only and the page must not let the query string order it by
    something it does not expose.
  */
  auditTrail: requirePermission("audit.read")
    .input(
      z
        .object({
          ...pageParamsSchema.shape,
          search: z.string().optional(),
          eventType: z.string().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }): Promise<Paginated<{
      id: number;
      eventType: string;
      occurredAt: Date;
      note: string | null;
      tag: string | null;
      model: string;
      actorName: string | null;
    }>> => {
      const tid = ctx.session.tenantId;
      const conditions = [eq(schema.transaction.tenantId, tid)];
      /* `audit.read` is held only by System Admin, Equipment Admin, Office
         Admin and Finance — all of whom hold `assets.view.all`, so this
         predicate is a no-op today. It is here so that stays true by
         construction rather than by coincidence: the moment the matrix grants
         `audit.read` to a scoped role, the trail narrows with it instead of
         becoming the way around every other control on this router. */
      const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
      if (scoped) conditions.push(scoped);
      if (input.eventType) conditions.push(eq(schema.transaction.eventType, input.eventType));
      if (input.search) {
        const q = `%${input.search}%`;
        conditions.push(
          or(
            ilike(schema.asset.tag, q),
            ilike(schema.asset.make, q),
            ilike(schema.asset.modelNumber, q),
            ilike(schema.asset.description, q),
            ilike(schema.transaction.note, q),
          )!,
        );
      }

      const [countResult] = await ctx.db
        .select({ c: sql<number>`count(*)` })
        .from(schema.transaction)
        .leftJoin(schema.asset, eq(schema.transaction.assetId, schema.asset.id))
        .where(and(...conditions));

      const sortable: SortableMap = {
        occurredAt: sql`${schema.transaction.occurredAt}`,
        eventType: sql`${schema.transaction.eventType}`,
        note: sql`${schema.transaction.note}`,
        tag: sql`${schema.asset.tag}`,
      };
      const order = sortSql(input, sortable) ?? desc(schema.transaction.occurredAt);

      const rows = await ctx.db
        .select({
          id: schema.transaction.id,
          eventType: schema.transaction.eventType,
          occurredAt: schema.transaction.occurredAt,
          note: schema.transaction.note,
          tag: schema.asset.tag,
          make: schema.asset.make,
          modelNumber: schema.asset.modelNumber,
          description: schema.asset.description,
          actorName: schema.user.firstName,
        })
        .from(schema.transaction)
        .leftJoin(schema.asset, eq(schema.transaction.assetId, schema.asset.id))
        .leftJoin(schema.user, eq(schema.transaction.actorId, schema.user.id))
        .where(and(...conditions))
        .orderBy(order)
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      return {
        rows: rows.map((r) => ({
          id: r.id,
          eventType: r.eventType,
          occurredAt: r.occurredAt,
          note: r.note,
          tag: r.tag,
          model: [r.make, r.modelNumber, r.description].filter(Boolean).join(" "),
          actorName: r.actorName,
        })),
        total: Number(countResult?.c ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),
});
