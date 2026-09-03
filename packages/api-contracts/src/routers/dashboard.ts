import { and, count, desc, eq, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { formatAssetModel } from "@stinventory/types";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { assetVisibility, assetScopeWhere, type AssetScope } from "../scope.js";

export const dashboardRouter = router({
  /*
    STI-302: every number on this page is now scoped.

    The KPI tiles were the worst leak in the product and the least visible one.
    A count does not look like data — but "312 assigned" told a foreman who may
    see four tools exactly how many Urban owns, and the clearance tile named
    how many people had been terminated. An aggregate over rows you may not
    read is a read of those rows.
  */
  kpis: requirePermission("asset.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const scope = await assetVisibility(ctx.db, ctx.session);
    const scoped = assetScopeWhere(scope);

    const byStatus = (status: string) =>
      ctx.db
        .select({ c: count() })
        .from(schema.asset)
        .where(and(eq(schema.asset.tenantId, tid), eq(schema.asset.currentStatus, status), scoped))
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
        scoped,
      ))
      .then((r) => Number(r[0]?.c ?? 0));

    const terminated = await ctx.db
      .select({ id: schema.employee.id })
      .from(schema.employee)
      .where(and(eq(schema.employee.tenantId, tid), eq(schema.employee.employmentStatus, "terminated")));

    const termIds = terminated.map((t) => t.id);

    /*
      `terminatedCount` used to be every terminated employee in the tenant — an
      HR fact, on a tools dashboard, readable by a foreman.

      The desk keeps EXACTLY the number it had: at `assets.view.all` the tile
      still means "terminated staff", including people who hold nothing and so
      need no clearance. Narrowing that for the desk would be a product change
      to a shipped tile, which is not what STI-302 asks for.

      Below `all` the same tile answers the only version of the question the
      caller can act on — "has someone whose tools I can see left the company"
      — counted over the same scoped asset set as `clearanceCount`, so
      "2 people, 9 tools" can never name people the caller has never heard of.
    */
    const clearanceRows = termIds.length
      ? await ctx.db
          .select({ custodianId: schema.asset.currentCustodianId })
          .from(schema.asset)
          .where(
            and(
              eq(schema.asset.tenantId, tid),
              ne(schema.asset.currentStatus, "available"),
              inArray(schema.asset.currentCustodianId, termIds),
              scoped,
            ),
          )
      : [];

    const clearanceCount = clearanceRows.length;
    const terminatedCount =
      scope.tier === "assets.view.all"
        ? terminated.length
        : new Set(clearanceRows.map((r) => r.custodianId)).size;

    return {
      available,
      assigned,
      inMaintenance,
      lost,
      reserved,
      scheduledMaint: 0,
      clearanceCount,
      terminatedCount,
      missingSerial,
    };
  }),

  /*
    STI-307: this branched on `ctx.session.roleName === "foreman"` to decide
    whether the feed was narrowed to one person. That is the exact pattern
    SYSTEM_PLAN §9 forbids — it meant a superintendent, a mechanic and an
    engineer all silently got the desk's tenant-wide feed, and adding a role
    got the wrong answer by default rather than by decision.

    The ladder answers it properly now: `own` narrows to the caller, `crew` to
    their crew, `project` to their jobs, `all` to everything. The explicit
    `employeeId` input still narrows FURTHER (it is how the tool detail page
    asks for one person's history) but it can no longer widen — it is ANDed
    with the scope, not substituted for it.
  */
  recentActivity: requirePermission("asset.read")
    .input(z.object({ employeeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
      const conditions = [eq(schema.transaction.tenantId, tid)];
      if (scoped) conditions.push(scoped);
      if (input?.employeeId) conditions.push(eq(schema.asset.currentCustodianId, input.employeeId));
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

  clearanceQueue: requirePermission("asset.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
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
        and(
          eq(schema.asset.tenantId, tid),
          ne(schema.asset.currentStatus, "available"),
          inArray(schema.asset.currentCustodianId, termIds),
          scoped,
        ),
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
  pendingApprovals: requirePermission("assignment.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    /* Scoped through the ASSET rather than the assignment's custodian: the
       question the queue answers is "what is waiting on a tool I can see",
       and a pending row names a custodian the tool does not have yet. Scoping
       by the proposed custodian would hide from a superintendent the very
       hand-off that moves a tool OUT of their crew. */
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
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
      .where(and(eq(schema.assignment.tenantId, tid), eq(schema.assignment.status, "pending_approval"), scoped));
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
      .where(and(eq(schema.transfer.tenantId, tid), eq(schema.transfer.status, "pending_approval"), scoped));
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

    `unread` is the badge: your own unread alerts plus the three desk queues a
    person can actually work. It deliberately does NOT equal the number the
    popover prints beside "Open the inbox" — that one counts the queues only,
    because your alerts are not inbox rows. This comment used to claim the two
    were the same sum and could not disagree; they were never equal, and saying
    so hid the fact that the badge was also summing in `clearance` (below).

    The alerts list is the top unread notifications for THIS user; the queue
    counts are scoped to the assets the caller may see.
  */
  notifications: requirePermission("notification.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const empId = ctx.session.employeeId;
    /* The badge sums the desk queues. Those counts used to be tenant-wide on
       the reasoning that "the desk owns them" — which was true of the three
       accounts that existed when it was written, all of which held
       `assets.view.all`. With a real role list it made the bell tell a foreman
       how many approvals, tasks and stuck messages exist across every job at
       Urban. Scoped to the same asset set as the rest of the page. */
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
    /*
      The queue counts are all counts OF ASSETS — approvals, clearance and
      asset-linked tasks. A caller without `asset.read` may not read those rows,
      so they may not be told how many there are either: HR holds
      `notification.read` and deliberately not `asset.read`, and the bell was
      telling them "25", of which 23 was the number of tools a terminated
      employee is still holding. Same leak as `report.assetRegister` and
      `dashboard.charts`, one layer further out — a badge is an aggregate too.

      The bell still works for them: `alerts` is their own notification rows and
      is unaffected.
    */
    const mayCountAssets = ctx.session.permissions.has("asset.read");
    const today = new Date().toISOString().slice(0, 10);

    /*
      No employee record means no alerts, full stop. A notification is delivered
      TO an employee — `recipientEmployeeId` is never null on a delivered row —
      so an account without one is the recipient of nothing.

      This used to pass `undefined` as the recipient predicate, which Drizzle's
      `and()` DROPS rather than reading as "match nothing": the filter vanished
      and the query returned every unread notification in the tenant. Seven of
      the fifteen seeded accounts have no employee row (`owner@`, `hr@`,
      `finance@`, `office@`, `procurement@`, `readonly@`, `invited@`), and in
      production the owner was being shown other people's repair decisions —
      then could not clear them, because `notification.markRead` scopes to the
      recipient and correctly refused. One nullable column, two symptoms.

      Written as a short-circuit rather than a `sql`false`` predicate so the
      round-trip is not made at all.
    */
    const myUnread = empId
      ? and(
          eq(schema.notification.tenantId, tid),
          isNull(schema.notification.readAt),
          eq(schema.notification.recipientEmployeeId, empId),
        )
      : null;

    const [alerts, unreadAlerts, approvals, tasks, messages, clearance] = await Promise.all([
      myUnread
        ? ctx.db
            .select({ id: schema.notification.id, title: schema.notification.title, body: schema.notification.body, createdAt: schema.notification.createdAt })
            .from(schema.notification)
            .where(myUnread)
            .orderBy(desc(schema.notification.createdAt))
            .limit(5)
        : Promise.resolve([] as { id: string; title: string; body: string | null; createdAt: Date }[]),
      /* The TRUE count, not `alerts.length` — that list is capped at five for
         the popover, so the badge silently under-reported anyone with a real
         backlog at exactly the moment the number mattered most. */
      myUnread
        ? ctx.db
            .select({ c: count() })
            .from(schema.notification)
            .where(myUnread)
            .then((r) => Number(r[0]?.c ?? 0))
        : Promise.resolve(0),
      (async () => {
        if (!mayCountAssets) return 0;
        const [a, t] = await Promise.all([
          ctx.db
            .select({ c: count() })
            .from(schema.assignment)
            .innerJoin(schema.asset, eq(schema.assignment.assetId, schema.asset.id))
            .where(and(eq(schema.assignment.tenantId, tid), eq(schema.assignment.status, "pending_approval"), scoped)),
          ctx.db
            .select({ c: count() })
            .from(schema.transfer)
            .innerJoin(schema.asset, eq(schema.transfer.assetId, schema.asset.id))
            .where(and(eq(schema.transfer.tenantId, tid), eq(schema.transfer.status, "pending_approval"), scoped)),
        ]);
        return Number(a[0]?.c ?? 0) + Number(t[0]?.c ?? 0);
      })(),
      /* A task usually names a tool (`relatedAssetId`) — scope on it when it
         does. A task with NO related asset is a plain request the desk owns
         ("order two more grinders"); those are counted only for the desk,
         because a foreman being told there are eleven open requests he cannot
         see or act on is noise, and the eleven is itself a disclosure. */
      (!mayCountAssets ? Promise.resolve(0) : ctx.db
        .select({ c: count() })
        .from(schema.task)
        .leftJoin(schema.asset, eq(schema.task.relatedAssetId, schema.asset.id))
        .where(
          and(
            eq(schema.task.tenantId, tid),
            notInArray(schema.task.status, ["completed", "cancelled"]),
            scoped ? scoped : undefined,
          ),
        )
        .then((r) => Number(r[0]?.c ?? 0))),
      /* Stuck messages are the DESK's queue and only the desk can clear them
         (`messaging.dismiss` needs `notification.manage` since STI-308). A
         message that could not be parsed has, by definition, no resolved asset
         to scope on — that is why it is stuck — so there is nothing to narrow
         it by. Counted for whoever can act on it, and zero for everyone else,
         rather than shown to people with no way to clear it. */
      (ctx.session.permissions.has("notification.manage")
        ? ctx.db
            .select({ c: count() })
            .from(schema.message)
            .where(
              and(
                eq(schema.message.tenantId, tid),
                inArray(schema.message.processingStatus, ["pending_manual", "error"]),
              ),
            )
            .then((r) => Number(r[0]?.c ?? 0))
        : Promise.resolve(0)),
      (!mayCountAssets ? Promise.resolve(0) : ctx.db
        .select({ c: count() })
        .from(schema.asset)
        .innerJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
        .where(
          and(
            eq(schema.asset.tenantId, tid),
            eq(schema.employee.employmentStatus, "terminated"),
            ne(schema.asset.currentStatus, "available"),
            scoped,
          ),
        )
        .then((r) => Number(r[0]?.c ?? 0))),
    ]);

    return {
      alerts: alerts.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        createdAt: a.createdAt,
      })),
      queues: { approvals, tasks, messages, clearance },
      /*
        `clearance` is counted and returned but NOT summed into the badge. It
        is the HR offboarding gate, which was removed on 2026-08-27 — the
        popover already declines to list it as a queue for that reason, so
        summing it here inflated the bell with work nobody is asked to do and
        no screen can clear. It was 23 of 30 on a seeded database.

        Left in `queues` rather than deleted: the count is a real thing (tools
        still held by terminated employees) and `dashboard.notifications` is
        not the place to decide whether the product wants it back.
      */
      unread: unreadAlerts + approvals + tasks + messages,
    };
  }),

  /*
    The dashboard widgets' numbers — static aggregates over the ledger, no LLM.

    Three shapes feed the recharts widgets: the fleet split by status, capital
    by who pays (project vs department), and the movement rate per week folded
    from the transaction log. All read-only; the ledger stays the source.
  */
  /*
    `asset.read`, not `report.read`. These three widgets are asset data wearing
    a chart: the status split counts assets, the capital split SUMS them, and
    the movement rate folds their ledger. Gating them on the reports permission
    let HR — who holds `report.read` and deliberately not `asset.read` — read
    the total value of Urban's tool fleet off the dashboard. Same class of
    mistake as `report.assetRegister`; both were found by probing all thirteen
    roles against the running API.
  */
  charts: requirePermission("asset.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    /* `capitalSplit` sums acquisition cost. An unscoped sum is the single most
       revealing number on the page — it tells anyone who can load a dashboard
       what Urban's tool fleet is worth — and it was computed over every row in
       the tenant. */
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));

    const statuses = await ctx.db
      .select({ status: schema.asset.currentStatus, count: count() })
      .from(schema.asset)
      .where(and(eq(schema.asset.tenantId, tid), scoped))
      .groupBy(schema.asset.currentStatus);

    const capital = await ctx.db
      .select({
        kind: sql<string>`case when ${schema.asset.costTarget} = 'department' then 'department' else 'project' end`,
        value: sql<string>`coalesce(sum(${schema.asset.acquisitionCost}::numeric),0)`,
      })
      .from(schema.asset)
      .where(and(eq(schema.asset.tenantId, tid), scoped))
      .groupBy(sql`1`);

    /* The movement rate joins the asset so the ledger can be scoped by the
       same predicate as everything else. The ledger itself is not scoped —
       it is append-only history — but a chart OVER it is a read of the rows
       it counts. */
    const movements = await ctx.db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${schema.transaction.occurredAt}), 'YYYY-MM-DD')`,
        count: count(),
      })
      .from(schema.transaction)
      .innerJoin(schema.asset, eq(schema.transaction.assetId, schema.asset.id))
      .where(
        and(
          eq(schema.transaction.tenantId, tid),
          sql`${schema.transaction.occurredAt} >= now() - interval '8 weeks'`,
          scoped,
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    /* UI-70: the split names BOTH sides, including one that is currently zero.
       `GROUP BY` only emits kinds that have rows, so a tenant whose tools are
       all charged to projects got a single-row result — and a chart headed
       "projects versus departments" then had no way to answer the literal
       question on the ticket, "how is the $77,710 divided", because the other
       half of the comparison was not in the payload at all. Zero is an answer;
       absent is not — and on the deployed tenant, where every tool is charged to
       a project, "absent" is exactly what the department side was. The legend
       reads "Department $0 · Project $77,710" now, which is the sentence the
       ticket asked for. */
    const capitalByKind = new Map(capital.map((c) => [c.kind, c.value]));

    return {
      statusDistribution: statuses.map((s) => ({ status: s.status, count: Number(s.count) })),
      capitalSplit: (["project", "department"] as const).map((kind) => ({
        kind,
        value: capitalByKind.get(kind) ?? "0",
      })),
      movementsByWeek: movements.map((m) => ({ week: m.week, count: Number(m.count) })),
    };
  }),
});
