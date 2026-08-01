import { and, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { byMostOverdue } from "@stinventory/domain";
import { formatAssetModel } from "@stinventory/types";
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

    /* Serialized tools with no serial are the data-quality number that matters
       most: they cannot be identified after a theft, matched against a police
       report, or deduped on import. Bulk lines legitimately have no serial and
       must not count. */
    const missingSerial = await ctx.db
      .select({ c: count() })
      .from(schema.asset)
      .where(and(
        eq(schema.asset.tenantId, tid),
        eq(schema.asset.isSerialized, true),
        isNull(schema.asset.serialNumber),
      ))
      .then((r) => Number(r[0]?.c ?? 0));

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
      missingSerial,
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
          make: schema.asset.make,
          modelNumber: schema.asset.modelNumber,
          description: schema.asset.description,
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
        /* An untagged tool sorts fine once the tag is a string; the sort only
           needs it as a stable tie-break. */
        tag: r.tag ?? "",
        modelName: formatAssetModel(r),
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
          assetMake: schema.asset.make,
          assetModelNumber: schema.asset.modelNumber,
          assetDescription: schema.asset.description,
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
        make: schema.asset.make,
        modelNumber: schema.asset.modelNumber,
        description: schema.asset.description,
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

  /*
    What the desk has not signed off yet, for one person, read-only.

    Approvals belong to the desk — a foreman holds `transfer.create` but not
    `transfer.approve`, and that is deliberate: accepting a $12k tool onto
    somebody's name is the equipment department's call. But "the foreman cannot
    approve it" was being implemented as "the foreman is not told about it",
    which are different things and the second one costs custody accuracy.

    The outbound direction is the one that matters. A foreman who hands a tool
    to somebody in the yard believes they are rid of it; until the desk signs
    the transfer off they are still the custodian of record, and they are the
    only person who can tell you where the tool physically is. A screen that
    says "still yours until the desk clears it" is the difference between a
    stale record somebody can explain and one nobody can.

    Deliberately has no mutations. This is a window onto the desk's queue, not
    a back door into it.
  */
  awaitingDesk: protectedProcedure
    .input(z.object({ employeeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const empId = input?.employeeId ?? ctx.session.employeeId;
      /* No employee record means no custody, so nothing here can apply. */
      if (!empId) return [];

      const transfers = await ctx.db
        .select({
          id: schema.transfer.id,
          assetId: schema.transfer.assetId,
          tag: schema.asset.tag,
          make: schema.asset.make,
          modelNumber: schema.asset.modelNumber,
          description: schema.asset.description,
          fromCustodianId: schema.transfer.fromCustodianId,
          toCustodianId: schema.transfer.toCustodianId,
          createdAt: schema.transfer.createdAt,
        })
        .from(schema.transfer)
        .innerJoin(schema.asset, eq(schema.transfer.assetId, schema.asset.id))
        .where(
          and(
            eq(schema.transfer.tenantId, tid),
            eq(schema.transfer.status, "pending_approval"),
            or(
              eq(schema.transfer.toCustodianId, empId),
              eq(schema.transfer.fromCustodianId, empId),
            ),
          ),
        );

      const assignments = await ctx.db
        .select({
          id: schema.assignment.id,
          assetId: schema.assignment.assetId,
          tag: schema.asset.tag,
          make: schema.asset.make,
          modelNumber: schema.asset.modelNumber,
          description: schema.asset.description,
          createdAt: schema.assignment.createdAt,
        })
        .from(schema.assignment)
        .innerJoin(schema.asset, eq(schema.assignment.assetId, schema.asset.id))
        .where(
          and(
            eq(schema.assignment.tenantId, tid),
            eq(schema.assignment.status, "pending_approval"),
            eq(schema.assignment.custodianId, empId),
          ),
        );

      /* Names in one pass rather than a self-join with two aliases — at these
         volumes the join buys nothing and costs readability. */
      const otherIds = [
        ...new Set(
          transfers
            .map((t) => (t.toCustodianId === empId ? t.fromCustodianId : t.toCustodianId))
            .filter((id): id is string => !!id && id !== empId),
        ),
      ];
      const names = otherIds.length
        ? await ctx.db
            .select({ id: schema.employee.id, name: schema.employee.name })
            .from(schema.employee)
            .where(and(eq(schema.employee.tenantId, tid), inArray(schema.employee.id, otherIds)))
        : [];
      const nameById = new Map(names.map((n) => [n.id, n.name]));

      const rows = [
        ...transfers.map((t) => {
          const outbound = t.fromCustodianId === empId;
          const otherId = outbound ? t.toCustodianId : t.fromCustodianId;
          return {
            id: t.id,
            kind: "transfer" as const,
            /* Outbound wins a tool that is somehow both, which would mean a
               transfer to and from the same person — a no-op the executor
               refuses, but the projection should not depend on that. */
            direction: outbound ? ("outgoing" as const) : ("incoming" as const),
            assetId: t.assetId,
            tag: t.tag,
            modelName: formatAssetModel(t),
            otherPartyName: (otherId && nameById.get(otherId)) ?? null,
            createdAt: t.createdAt,
          };
        }),
        ...assignments.map((a) => ({
          id: a.id,
          kind: "assignment" as const,
          direction: "incoming" as const,
          assetId: a.assetId,
          tag: a.tag,
          modelName: formatAssetModel(a),
          otherPartyName: null,
          createdAt: a.createdAt,
        })),
      ];

      /* Oldest first: the one that has been sitting longest is the one worth
         asking the desk about. */
      return rows.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    }),

  pendingApprovals: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const pendingAssignments = await ctx.db
      .select({
        id: schema.assignment.id,
        type: sql<string>`'assignment'`,
        assetTag: schema.asset.tag,
        assetMake: schema.asset.make,
        assetModelNumber: schema.asset.modelNumber,
        assetDescription: schema.asset.description,
        custodianName: schema.employee.name,
        status: schema.assignment.status,
        fromName: sql<string | null>`null`,
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
        assetMake: schema.asset.make,
        assetModelNumber: schema.asset.modelNumber,
        assetDescription: schema.asset.description,
        custodianName: schema.employee.name,
        /* The desk has to be able to tell the two apart before it acts: one is
           "may this happen", the other is "this happened, is it right". */
        status: schema.transfer.status,
        fromName: sql<string | null>`(select name from employee where id = ${schema.transfer.fromCustodianId})`,
        createdAt: schema.transfer.createdAt,
      })
      .from(schema.transfer)
      .innerJoin(schema.asset, eq(schema.transfer.assetId, schema.asset.id))
      .innerJoin(schema.employee, eq(schema.transfer.toCustodianId, schema.employee.id))
      .where(
        and(
          eq(schema.transfer.tenantId, tid),
          inArray(schema.transfer.status, ["pending_approval", "pending_verification"]),
        ),
      );
    return [...pendingAssignments, ...pendingTransfers]
      .map((r) => ({
        ...r,
        assetModel: formatAssetModel({
          make: r.assetMake,
          modelNumber: r.assetModelNumber,
          description: r.assetDescription,
        }),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }),
});
