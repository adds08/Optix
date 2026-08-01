import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { isRentalOverdue, daysUntilOffRent } from "@stinventory/domain";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { pageParamsSchema } from "../table-helpers.js";
import { logEvent } from "../audit.js";

/*
  Rented equipment.

  The question this module exists to answer is "what are we still paying for
  that we are not using". Everything else here is in service of that.

  Note what is deliberately absent: any total cost. The export Urban can pull
  from the vendor carries no rates, so a cost figure would be invented. The
  fields exist on `rental_line` for when rates arrive; until they do, the API
  reports quantities and days, which are real.
*/

const today = () => new Date().toISOString().slice(0, 10);

export const rentalRouter = router({
  vendors: requirePermission("rental.read").query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: schema.vendor.id,
        name: schema.vendor.name,
        accountNumber: schema.vendor.accountNumber,
        contactName: schema.vendor.contactName,
        contactPhone: schema.vendor.contactPhone,
      })
      .from(schema.vendor)
      .where(eq(schema.vendor.tenantId, ctx.session.tenantId))
      .orderBy(asc(schema.vendor.name));
  }),

  /*
    Orders with their lines rolled up.

    Two queries and a join in memory rather than one query per order — 60
    contracts with 137 lines between them is two round trips, not sixty-one.
  */
  list: requirePermission("rental.read")
    .input(
      z
        .object({
          status: z.string().optional(),
          vendorId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
          search: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const where = [eq(schema.rentalOrder.tenantId, tid)];
      if (input?.status && input.status !== "all") {
        where.push(eq(schema.rentalOrder.status, input.status));
      }
      if (input?.vendorId) where.push(eq(schema.rentalOrder.vendorId, input.vendorId));
      if (input?.projectId) where.push(eq(schema.rentalOrder.projectId, input.projectId));

      const orders = await ctx.db
        .select({
          id: schema.rentalOrder.id,
          externalNumber: schema.rentalOrder.externalNumber,
          orderType: schema.rentalOrder.orderType,
          status: schema.rentalOrder.status,
          jobsiteLabel: schema.rentalOrder.jobsiteLabel,
          projectId: schema.rentalOrder.projectId,
          projectName: schema.project.name,
          orderedByLabel: schema.rentalOrder.orderedByLabel,
          startDate: schema.rentalOrder.startDate,
          endDate: schema.rentalOrder.endDate,
          notes: schema.rentalOrder.notes,
          vendorId: schema.rentalOrder.vendorId,
          vendorName: schema.vendor.name,
        })
        .from(schema.rentalOrder)
        .innerJoin(schema.vendor, eq(schema.rentalOrder.vendorId, schema.vendor.id))
        .leftJoin(schema.project, eq(schema.rentalOrder.projectId, schema.project.id))
        .where(and(...where))
        .orderBy(desc(schema.rentalOrder.startDate));

      if (!orders.length) return [];

      const lines = await ctx.db
        .select()
        .from(schema.rentalLine)
        .where(
          and(
            eq(schema.rentalLine.tenantId, tid),
            inArray(
              schema.rentalLine.orderId,
              orders.map((o) => o.id),
            ),
          ),
        );

      const t = today();
      const byOrder = new Map<string, typeof lines>();
      for (const l of lines) {
        const list = byOrder.get(l.orderId);
        if (list) list.push(l);
        else byOrder.set(l.orderId, [l]);
      }

      const matches = (o: (typeof orders)[number], ls: typeof lines) => {
        const q = input?.search?.trim().toLowerCase();
        if (!q) return true;
        return (
          o.externalNumber.toLowerCase().includes(q) ||
          (o.jobsiteLabel ?? "").toLowerCase().includes(q) ||
          (o.vendorName ?? "").toLowerCase().includes(q) ||
          ls.some(
            (l) =>
              l.itemName.toLowerCase().includes(q) ||
              (l.catClass ?? "").toLowerCase().includes(q),
          )
        );
      };

      return orders
        .map((o) => {
          const ls = byOrder.get(o.id) ?? [];
          const onRent = ls.filter((l) => l.status === "on_rent");
          return {
            ...o,
            lines: ls.map((l) => ({
              ...l,
              /* Derived, never stored — a line becomes overdue by the clock
                 moving, not by anything happening to the row. */
              overdue: isRentalOverdue({ status: l.status, endDate: l.endDate, today: t }),
              daysToOffRent: daysUntilOffRent(l.endDate, t),
            })),
            lineCount: ls.length,
            onRentCount: onRent.length,
            unitCount: onRent.reduce((n, l) => n + (l.quantity ?? 0), 0),
            overdueCount: onRent.filter((l) =>
              isRentalOverdue({ status: l.status, endDate: l.endDate, today: t }),
            ).length,
          };
        })
        .filter((o) => matches(o, byOrder.get(o.id) ?? []));
    }),

  /*
    The report that pays for this module.

    Every line still on rent, soonest-due first, with the ones already past
    their end date at the top. This is the list somebody works down on a Monday
    morning with the vendor's number open.
  */
  onRent: requirePermission("rental.read")
    .input(
      z
        .object({
          ...pageParamsSchema.shape,
          search: z.string().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const params = input;
      const rows = await ctx.db
        .select({
          lineId: schema.rentalLine.id,
          itemName: schema.rentalLine.itemName,
          catClass: schema.rentalLine.catClass,
          quantity: schema.rentalLine.quantity,
          endDate: schema.rentalLine.endDate,
          status: schema.rentalLine.status,
          orderId: schema.rentalOrder.id,
          externalNumber: schema.rentalOrder.externalNumber,
          jobsiteLabel: schema.rentalOrder.jobsiteLabel,
          projectName: schema.project.name,
          vendorName: schema.vendor.name,
        })
        .from(schema.rentalLine)
        .innerJoin(schema.rentalOrder, eq(schema.rentalLine.orderId, schema.rentalOrder.id))
        .innerJoin(schema.vendor, eq(schema.rentalOrder.vendorId, schema.vendor.id))
        .leftJoin(schema.project, eq(schema.rentalOrder.projectId, schema.project.id))
        .where(and(eq(schema.rentalLine.tenantId, tid), eq(schema.rentalLine.status, "on_rent")));

      const t = today();
      let out = rows.map((r) => ({
        ...r,
        overdue: isRentalOverdue({ status: r.status, endDate: r.endDate, today: t }),
        daysToOffRent: daysUntilOffRent(r.endDate, t),
      }));

      /* Search runs server-side over the fields a person actually says. */
      if (params.search) {
        const q = params.search.toLowerCase();
        out = out.filter((r) =>
          [r.itemName, r.externalNumber, r.vendorName, r.jobsiteLabel]
            .some((v) => v?.toLowerCase().includes(q)),
        );
      }

      /* Whitelisted column sorts; anything else falls back to the canonical
         soonest-due-first order. The comparator map is the whitelist. */
      const SORTABLE: Record<string, (a: (typeof out)[number], b: (typeof out)[number]) => number> = {
        itemName: (a, b) => a.itemName.localeCompare(b.itemName),
        vendorName: (a, b) => (a.vendorName ?? "").localeCompare(b.vendorName ?? ""),
        endDate: (a, b) => (a.endDate ?? "9999").localeCompare(b.endDate ?? "9999"),
        quantity: (a, b) => (a.quantity ?? 0) - (b.quantity ?? 0),
      };
      const sort = params.sortKey ? SORTABLE[params.sortKey] : undefined;
      if (sort) {
        const dir = params.sortDir === "desc" ? -1 : 1;
        out.sort((a, b) => sort(a, b) * dir);
      } else {
        /* Nulls last: a line with no end date is open-ended, which is a data
           problem to chase but not a bill to stop today. */
        out.sort((a, b) => (a.daysToOffRent ?? 9_999) - (b.daysToOffRent ?? 9_999));
      }

      const total = out.length;
      const page = params.page ?? 1;
      const pageSize = params.pageSize ?? 25;
      return {
        rows: out.slice((page - 1) * pageSize, page * pageSize),
        total,
        page,
        pageSize,
      };
    }),

  /* Headline numbers for the dashboard tile. */
  summary: requirePermission("rental.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const rows = await ctx.db
      .select({
        quantity: schema.rentalLine.quantity,
        endDate: schema.rentalLine.endDate,
        status: schema.rentalLine.status,
      })
      .from(schema.rentalLine)
      .where(eq(schema.rentalLine.tenantId, tid));

    const t = today();
    const onRent = rows.filter((r) => r.status === "on_rent");
    return {
      onRentLines: onRent.length,
      onRentUnits: onRent.reduce((n, r) => n + (r.quantity ?? 0), 0),
      overdueLines: onRent.filter((r) =>
        isRentalOverdue({ status: r.status, endDate: r.endDate, today: t }),
      ).length,
      dueThisWeek: onRent.filter((r) => {
        const d = daysUntilOffRent(r.endDate, t);
        return d !== null && d >= 0 && d <= 7;
      }).length,
      quotedLines: rows.filter((r) => r.status === "quoted").length,
    };
  }),

  /*
    Call a line off rent.

    The one write in this module that stops money leaving. It records the date
    the yard says it went back, not the date somebody got round to typing it —
    those differ, and the vendor will bill against theirs.
  */
  offRent: requirePermission("rental.manage")
    .input(
      z.object({
        lineId: z.string().uuid(),
        returnedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const line = await ctx.db.query.rentalLine.findFirst({
        where: and(eq(schema.rentalLine.id, input.lineId), eq(schema.rentalLine.tenantId, tid)),
      });
      if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "No such rental line" });
      if (line.status === "returned") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That line is already off rent." });
      }

      const returnedOn = input.returnedOn ?? today();
      await ctx.db
        .update(schema.rentalLine)
        .set({
          status: "returned",
          returnedOn,
          notes: input.note ?? line.notes,
          updatedAt: new Date(),
        })
        .where(eq(schema.rentalLine.id, input.lineId));

      /* When the last live line goes back the contract is done — otherwise it
         sits "on rent" forever and the list nobody trusts grows. */
      const [remaining] = await ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(schema.rentalLine)
        .where(
          and(
            eq(schema.rentalLine.orderId, line.orderId),
            eq(schema.rentalLine.status, "on_rent"),
          ),
        );
      if (Number(remaining?.n ?? 0) === 0) {
        await ctx.db
          .update(schema.rentalOrder)
          .set({ status: "closed", orderType: "closed_contract", updatedAt: new Date() })
          .where(eq(schema.rentalOrder.id, line.orderId));
      }

      await logEvent(ctx, {
        category: "asset",
        action: "rental.offRent",
        entityType: "rental_line",
        entityId: input.lineId,
        entityLabel: line.itemName,
        details: { returnedOn, orderId: line.orderId },
      });
      return { ok: true, returnedOn, orderClosed: Number(remaining?.n ?? 0) === 0 };
    }),

  /*
    Attach a vendor's jobsite text to one of Urban's projects.

    The vendor calls it "TXDOT PUMP STATION IMPROVEMENT"; Urban calls it
    something else with a cost code. Nothing can match those automatically, so
    a person does it once and every future order on that jobsite label can be
    matched the same way.
  */
  linkProject: requirePermission("rental.manage")
    .input(
      z.object({
        orderId: z.string().uuid(),
        projectId: z.string().uuid().nullable(),
        applyToMatchingJobsite: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const order = await ctx.db.query.rentalOrder.findFirst({
        where: and(eq(schema.rentalOrder.id, input.orderId), eq(schema.rentalOrder.tenantId, tid)),
      });
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "No such rental order" });

      if (input.projectId) {
        const proj = await ctx.db.query.project.findFirst({
          where: and(eq(schema.project.id, input.projectId), eq(schema.project.tenantId, tid)),
        });
        if (!proj) throw new TRPCError({ code: "NOT_FOUND", message: "No such project" });
      }

      let updated = 1;
      if (input.applyToMatchingJobsite && order.jobsiteLabel) {
        const rows = await ctx.db
          .update(schema.rentalOrder)
          .set({ projectId: input.projectId, updatedAt: new Date() })
          .where(
            and(
              eq(schema.rentalOrder.tenantId, tid),
              eq(schema.rentalOrder.jobsiteLabel, order.jobsiteLabel),
            ),
          )
          .returning({ id: schema.rentalOrder.id });
        updated = rows.length;
      } else {
        await ctx.db
          .update(schema.rentalOrder)
          .set({ projectId: input.projectId, updatedAt: new Date() })
          .where(eq(schema.rentalOrder.id, input.orderId));
      }

      await logEvent(ctx, {
        category: "project",
        action: "rental.linkProject",
        entityType: "rental_order",
        entityId: input.orderId,
        entityLabel: order.externalNumber,
        details: { projectId: input.projectId, updated },
      });
      return { ok: true, updated };
    }),

  /* Jobsite labels the vendor uses that nobody has matched to a project yet.
     Until these are linked, rented cost cannot be attributed to a job. */
  unlinkedJobsites: requirePermission("rental.read").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        jobsiteLabel: schema.rentalOrder.jobsiteLabel,
        orders: sql<number>`count(*)`,
      })
      .from(schema.rentalOrder)
      .where(
        and(
          eq(schema.rentalOrder.tenantId, ctx.session.tenantId),
          sql`${schema.rentalOrder.projectId} is null`,
          sql`${schema.rentalOrder.jobsiteLabel} is not null`,
        ),
      )
      .groupBy(schema.rentalOrder.jobsiteLabel)
      .orderBy(desc(sql`count(*)`));
    return rows.map((r) => ({ ...r, orders: Number(r.orders) }));
  }),
});
