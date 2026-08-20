import { and, count, desc, eq, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
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

    /* There was a `fleetValue` here — one sum of every acquisition cost in the
       tenant, computed on every dashboard load. Nothing displays it any more:
       it is a finance figure, and the desk does not issue, chase or write off a
       tool because of what the register totals. The same number is still
       reachable as a report (capital by project, by department, and the split
       chart), which is where somebody asking a financial question goes. */

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
      clearanceCount,
      terminatedCount: terminated.length,
      missingSerial,
    };
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

  /*
    The Approval queue's source. STI-206: it now carries the rig.

    The gate exists so a SECOND person consents to a movement, and consent to a
    movement you cannot fully see is weaker than it looks. The vehicle is not
    incidental — `SYSTEM_PLAN.md` §1 names "which trailer is it in" as one of
    the questions the system exists to answer. Without it the desk cannot catch
    a tool routed into a trailer already bound for a different jobsite, or a
    personal-allowance truck used where company property is expected.

    Both halves are joined tenant-scoped: the composite FK behind these columns
    proves the vehicle's TYPE and nothing about the tenant.

    `truckUnit`/`trailerUnit` are null when NOTHING WAS RECORDED. After
    STI-202's three-state rule that is an absence, not a claim of "no truck" —
    so the screen must say nothing there rather than render an empty slot.
  */
  pendingApprovals: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const aTruck = alias(schema.vehicle, "pending_assignment_truck");
    const aTrailer = alias(schema.vehicle, "pending_assignment_trailer");
    const tTruck = alias(schema.vehicle, "pending_transfer_truck");
    const tTrailer = alias(schema.vehicle, "pending_transfer_trailer");
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
        truckUnit: aTruck.unit,
        truckOwnership: aTruck.ownershipType,
        trailerUnit: aTrailer.unit,
      })
      .from(schema.assignment)
      .innerJoin(schema.asset, eq(schema.assignment.assetId, schema.asset.id))
      .innerJoin(schema.employee, eq(schema.assignment.custodianId, schema.employee.id))
      .leftJoin(aTruck, and(eq(schema.assignment.truckId, aTruck.id), eq(aTruck.tenantId, tid)))
      .leftJoin(aTrailer, and(eq(schema.assignment.trailerId, aTrailer.id), eq(aTrailer.tenantId, tid)))
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
        status: schema.transfer.status,
        fromName: sql<string | null>`(select name from employee where id = ${schema.transfer.fromCustodianId})`,
        createdAt: schema.transfer.createdAt,
        truckUnit: tTruck.unit,
        truckOwnership: tTruck.ownershipType,
        trailerUnit: tTrailer.unit,
      })
      .from(schema.transfer)
      .innerJoin(schema.asset, eq(schema.transfer.assetId, schema.asset.id))
      .innerJoin(schema.employee, eq(schema.transfer.toCustodianId, schema.employee.id))
      .leftJoin(tTruck, and(eq(schema.transfer.toTruckId, tTruck.id), eq(tTruck.tenantId, tid)))
      .leftJoin(tTrailer, and(eq(schema.transfer.toTrailerId, tTrailer.id), eq(tTrailer.tenantId, tid)))
      .where(and(eq(schema.transfer.tenantId, tid), eq(schema.transfer.status, "pending_approval")));
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

  /*
    The bell in the top bar: one round-trip that answers "is anything waiting,
    and what is it".

    The badge is the same sum the inbox shows — unread alerts plus every desk
    queue — so the bell and the inbox cannot disagree about the number. The
    alerts list is the top unread notifications for THIS user; the queue counts
    are tenant-wide, because the desk owns them and the bell is how the desk
    sees them without opening the page.
  */
  notifications: protectedProcedure.query(async ({ ctx }) => {    const tid = ctx.session.tenantId;
    const empId = ctx.session.employeeId;
    const today = new Date().toISOString().slice(0, 10);

    const [alerts, approvals, tasks, messages, clearance] = await Promise.all([
      ctx.db
        .select({ id: schema.notification.id, title: schema.notification.title, body: schema.notification.body, createdAt: schema.notification.createdAt })
        .from(schema.notification)
        .where(
          and(
            eq(schema.notification.tenantId, tid),
            isNull(schema.notification.readAt),
            empId ? eq(schema.notification.recipientEmployeeId, empId) : undefined,
          ),
        )
        .orderBy(desc(schema.notification.createdAt))
        .limit(5),
      (async () => {
        const [a, t] = await Promise.all([
          ctx.db
            .select({ c: count() })
            .from(schema.assignment)
            .where(and(eq(schema.assignment.tenantId, tid), eq(schema.assignment.status, "pending_approval"))),
          ctx.db
            .select({ c: count() })
            .from(schema.transfer)
            .where(and(eq(schema.transfer.tenantId, tid), eq(schema.transfer.status, "pending_approval"))),
        ]);
        return Number(a[0]?.c ?? 0) + Number(t[0]?.c ?? 0);
      })(),
      ctx.db
        .select({ c: count() })
        .from(schema.task)
        .where(
          and(
            eq(schema.task.tenantId, tid),
            notInArray(schema.task.status, ["completed", "cancelled"]),
          ),
        )
        .then((r) => Number(r[0]?.c ?? 0)),
      ctx.db
        .select({ c: count() })
        .from(schema.message)
        .where(
          and(
            eq(schema.message.tenantId, tid),
            inArray(schema.message.processingStatus, ["pending_manual", "error"]),
          ),
        )
        .then((r) => Number(r[0]?.c ?? 0)),
      ctx.db
        .select({ c: count() })
        .from(schema.asset)
        .innerJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
        .where(
          and(
            eq(schema.asset.tenantId, tid),
            eq(schema.employee.employmentStatus, "terminated"),
            ne(schema.asset.currentStatus, "available"),
          ),
        )
        .then((r) => Number(r[0]?.c ?? 0)),
    ]);

    return {
      alerts: alerts.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        createdAt: a.createdAt,
      })),
      queues: { approvals, tasks, messages, clearance },
      unread: alerts.length + approvals + tasks + messages + clearance,
    };
  }),

  /*
    The dashboard widgets' numbers — static aggregates over the ledger, no LLM.

    Three shapes feed the recharts widgets: the fleet split by status, capital
    by who pays (project vs department), and the movement rate per week folded
    from the transaction log. All read-only; the ledger stays the source.
  */
  charts: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;

    const statuses = await ctx.db
      .select({ status: schema.asset.currentStatus, count: count() })
      .from(schema.asset)
      .where(eq(schema.asset.tenantId, tid))
      .groupBy(schema.asset.currentStatus);

    const capital = await ctx.db
      .select({
        kind: sql<string>`case when ${schema.asset.costTarget} = 'department' then 'department' else 'project' end`,
        value: sql<string>`coalesce(sum(${schema.asset.acquisitionCost}::numeric),0)`,
      })
      .from(schema.asset)
      .where(eq(schema.asset.tenantId, tid))
      .groupBy(sql`1`);

    const movements = await ctx.db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${schema.transaction.occurredAt}), 'YYYY-MM-DD')`,
        count: count(),
      })
      .from(schema.transaction)
      .where(
        and(
          eq(schema.transaction.tenantId, tid),
          sql`${schema.transaction.occurredAt} >= now() - interval '8 weeks'`,
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    return {
      statusDistribution: statuses.map((s) => ({ status: s.status, count: Number(s.count) })),
      capitalSplit: capital.map((c) => ({ kind: c.kind, value: c.value })),
      movementsByWeek: movements.map((m) => ({ week: m.week, count: Number(m.count) })),
    };
  }),
});
