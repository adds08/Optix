import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
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
        siteAddress: schema.project.siteAddress,
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
        siteAddress: z.string().max(400).optional(),
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

  update: requirePermission("project.manage")
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        externalId: z.string().max(60).nullable().optional(),
        status: z.string().max(30).optional(),
        costCenter: z.string().max(60).nullable().optional(),
        siteAddress: z.string().max(400).nullable().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const { id, ...changes } = input;
      const existing = await ctx.db.query.project.findFirst({
        where: and(eq(schema.project.id, id), eq(schema.project.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such project in this tenant" });

      const patch = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      if (!Object.keys(patch).length) return existing;

      const [row] = await ctx.db
        .update(schema.project)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(schema.project.id, id), eq(schema.project.tenantId, tid)))
        .returning();

      await logEvent(ctx, {
        category: "project", action: "update", entityType: "project",
        entityId: id, entityLabel: row?.name ?? existing.name,
        details: { changed: Object.keys(patch) },
      });
      return row;
    }),

  /*
    A job that anything points at is closed, not deleted.

    Tools carry `owningProjectId` for who paid — dropping the project would
    null that out and lose the answer to "what did this job spend on tools",
    which is the report the equipment department exists to produce.
  */
  delete: requirePermission("project.manage")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.project.findFirst({
        where: and(eq(schema.project.id, input.id), eq(schema.project.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such project in this tenant" });

      const [owned] = await ctx.db
        .select({ id: schema.asset.id })
        .from(schema.asset)
        .where(and(eq(schema.asset.tenantId, tid), eq(schema.asset.owningProjectId, input.id)))
        .limit(1);
      const [working] = await ctx.db
        .select({ id: schema.asset.id })
        .from(schema.asset)
        .where(and(eq(schema.asset.tenantId, tid), eq(schema.asset.currentProjectId, input.id)))
        .limit(1);
      const [posted] = await ctx.db
        .select({ id: schema.employeeProjectAssignment.id })
        .from(schema.employeeProjectAssignment)
        .where(
          and(
            eq(schema.employeeProjectAssignment.tenantId, tid),
            eq(schema.employeeProjectAssignment.projectId, input.id),
          ),
        )
        .limit(1);

      if (owned || working || posted) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Tools or people are attached to this job. Set it to complete instead — deleting it would lose what it spent.",
        });
      }

      await ctx.db.delete(schema.project).where(and(eq(schema.project.id, input.id), eq(schema.project.tenantId, tid)));
      await logEvent(ctx, {
        category: "project", action: "delete", entityType: "project",
        entityId: input.id, entityLabel: existing.name,
      });
      return { ok: true };
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

      /* Opening the posting here rather than leaving it to the first move means
         the history starts at hire, not at the first time somebody changed job
         through this screen. */
      if (row && input.primaryProjectId) {
        await ctx.db.insert(schema.employeeProjectAssignment).values({
          tenantId: ctx.session.tenantId,
          employeeId: row.id,
          projectId: input.primaryProjectId,
          startedOn: new Date().toISOString().slice(0, 10),
          assignedByUserId: ctx.session.userId,
          note: "Initial posting",
        });
      }
      return row;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const reportsTo = alias(schema.employee, "reports_to");
      const [row] = await ctx.db
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
        .where(
          and(
            eq(schema.employee.id, input.id),
            eq(schema.employee.tenantId, ctx.session.tenantId),
          ),
        );
      return row ?? null;
    }),

  /*
    Where this person has worked, newest first.

    `employee.primaryProjectId` is overwritten on every move, so it can only
    answer "now". This is the backtrack: tools follow the foreman rather than
    the site, so pairing these postings with the asset ledger is what says
    which job a tool was working on any given week.
  */
  postings: protectedProcedure
    .input(z.object({ employeeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: schema.employeeProjectAssignment.id,
          projectId: schema.employeeProjectAssignment.projectId,
          projectName: schema.project.name,
          projectExternalId: schema.project.externalId,
          startedOn: schema.employeeProjectAssignment.startedOn,
          endedOn: schema.employeeProjectAssignment.endedOn,
          note: schema.employeeProjectAssignment.note,
          createdAt: schema.employeeProjectAssignment.createdAt,
        })
        .from(schema.employeeProjectAssignment)
        .leftJoin(schema.project, eq(schema.employeeProjectAssignment.projectId, schema.project.id))
        .where(
          and(
            eq(schema.employeeProjectAssignment.tenantId, ctx.session.tenantId),
            eq(schema.employeeProjectAssignment.employeeId, input.employeeId),
          ),
        )
        .orderBy(desc(schema.employeeProjectAssignment.startedOn));
    }),

  /*
    Post a person to a job — the PM's move, recorded by the equipment desk.

    The rule this encodes is the one that makes small tools different from
    heavy equipment: tools belong to the foreman, not the site. When a foreman
    moves job, everything in their custody moves with them, so the operational
    project on each tool has to follow or every "what is on Legacy West?" report
    goes stale the day somebody transfers.

    Three things change, in one transaction:
      1. the open posting closes and a new one opens (the backtrack),
      2. `employee.primaryProjectId` catches up (the fast answer),
      3. every tool they hold gets `currentProjectId` moved, with a
         `project_change` event each so the ledger can still rebuild it.

    `owningProjectId` is deliberately untouched. Whoever's capital bought the
    tool keeps paying for it; moving job does not re-charge it. That split is
    the whole point of having two project columns.
  */
  assignToProject: requirePermission("employee.manage")
    .input(
      z.object({
        employeeId: z.string().uuid(),
        projectId: z.string().uuid(),
        startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        note: z.string().max(500).optional(),
        /* Off only for a correction — posting somebody retroactively where
           their tools already moved by hand. */
        moveTools: z.boolean().default(true),
        /* On by default the other way: a foreman's trucks, and the trailers
           hitched to them, go to the new job with the tools — the tools
           physically live in them. A superintendent who wants the foreman to
           leave the trailer (and its tools) behind on the old site turns this
           on; the trucks still follow, because the foreman drives them. */
        leaveContainers: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const startedOn = input.startedOn ?? new Date().toISOString().slice(0, 10);

      const [person] = await ctx.db
        .select({ id: schema.employee.id, name: schema.employee.name, primaryProjectId: schema.employee.primaryProjectId })
        .from(schema.employee)
        .where(and(eq(schema.employee.id, input.employeeId), eq(schema.employee.tenantId, tid)));
      if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "No such person in this tenant" });

      const [proj] = await ctx.db
        .select({ id: schema.project.id, name: schema.project.name })
        .from(schema.project)
        .where(and(eq(schema.project.id, input.projectId), eq(schema.project.tenantId, tid)));
      if (!proj) throw new TRPCError({ code: "NOT_FOUND", message: "No such project in this tenant" });

      const result = await ctx.db.transaction(async (tx: any) => {
        /* Close whatever is open. Ending on the same day the next posting
           starts keeps the history contiguous — a gap would read as time the
           person was on no job at all. */
        await tx
          .update(schema.employeeProjectAssignment)
          .set({ endedOn: startedOn })
          .where(
            and(
              eq(schema.employeeProjectAssignment.tenantId, tid),
              eq(schema.employeeProjectAssignment.employeeId, input.employeeId),
              isNull(schema.employeeProjectAssignment.endedOn),
            ),
          );

        const [posting] = await tx
          .insert(schema.employeeProjectAssignment)
          .values({
            tenantId: tid,
            employeeId: input.employeeId,
            projectId: input.projectId,
            startedOn,
            assignedByUserId: ctx.session.userId,
            note: input.note ?? null,
          })
          .returning();

        await tx
          .update(schema.employee)
          .set({ primaryProjectId: input.projectId })
          .where(eq(schema.employee.id, input.employeeId));

        if (!input.moveTools) return { postingId: posting?.id ?? null, toolsMoved: 0, containersMoved: 0 };

        /* Lost and disposed tools stay where the record says they were lost.
           Dragging them onto the new job would quietly rewrite where a police
           report has to point. */
        const held = await tx
          .select({
            id: schema.asset.id,
            tag: schema.asset.tag,
            currentStatus: schema.asset.currentStatus,
            currentCustodianId: schema.asset.currentCustodianId,
            currentProjectId: schema.asset.currentProjectId,
            currentLocationId: schema.asset.currentLocationId,
          })
          .from(schema.asset)
          .where(
            and(
              eq(schema.asset.tenantId, tid),
              eq(schema.asset.currentCustodianId, input.employeeId),
              notInArray(schema.asset.currentStatus, ["lost", "disposed"]),
            ),
          );

        /* The foreman's trucks follow, and the trailers hitched to them — a
           trailer attached to the truck rides with it. Tools are usually in
           the trailer, so "the truck goes to the new job" has to take them
           along or every tool on the old site would stay booked to a job
           nobody is running. */
        const vehicles = await tx
          .select({
            id: schema.vehicle.id,
            vehicleType: schema.vehicle.vehicleType,
            locationId: schema.vehicle.locationId,
          })
          .from(schema.vehicle)
          .where(and(eq(schema.vehicle.tenantId, tid), eq(schema.vehicle.foremanEmployeeId, input.employeeId)));

        const truckLocIds = vehicles.filter((v: any) => v.vehicleType === "truck").map((v: any) => v.locationId);
        const containerLocIds = new Set<string>(truckLocIds);
        if (!input.leaveContainers) {
          const trailerLocIds = vehicles.filter((v: any) => v.vehicleType === "trailer").map((v: any) => v.locationId);
          if (trailerLocIds.length) {
            const trailerLocs = await tx
              .select({
                id: schema.location.id,
                parentLocationId: schema.location.parentLocationId,
              })
              .from(schema.location)
              .where(and(eq(schema.location.tenantId, tid), inArray(schema.location.id, trailerLocIds)));
            for (const t of trailerLocs) {
              /* Only trailers actually hitched to one of the foreman's trucks
                 ride along — a trailer attached to somebody else's truck stays
                 with that truck. */
              if (t.parentLocationId && truckLocIds.includes(t.parentLocationId)) {
                containerLocIds.add(t.id);
              }
            }
          }
        }

        const aboard = containerLocIds.size
          ? await tx
              .select({
                id: schema.asset.id,
                tag: schema.asset.tag,
                currentStatus: schema.asset.currentStatus,
                currentCustodianId: schema.asset.currentCustodianId,
                currentProjectId: schema.asset.currentProjectId,
                currentLocationId: schema.asset.currentLocationId,
              })
              .from(schema.asset)
              .where(
                and(
                  eq(schema.asset.tenantId, tid),
                  inArray(schema.asset.currentLocationId, [...containerLocIds]),
                  notInArray(schema.asset.currentStatus, ["lost", "disposed"]),
                ),
              )
          : [];

        /* One tool, one entry: something the foreman holds directly and is
           also aboard a following truck is not moved twice. */
        const byId = new Map<string, any>();
        for (const a of held) byId.set(a.id, a);
        for (const a of aboard) byId.set(a.id, a);
        const moving = [...byId.values()].filter((a: any) => a.currentProjectId !== input.projectId);

        let toolsMoved = 0;
        if (moving.length) {
          const ids = moving.map((a: any) => a.id);

          await tx
            .update(schema.asset)
            .set({ currentProjectId: input.projectId, updatedAt: new Date() })
            .where(and(eq(schema.asset.tenantId, tid), inArray(schema.asset.id, ids)));

          /* Open custody links carry the project too, so the custody screen
             does not keep showing the job they just left. */
          await tx
            .update(schema.assignment)
            .set({ projectId: input.projectId, updatedAt: new Date() })
            .where(
              and(
                eq(schema.assignment.tenantId, tid),
                eq(schema.assignment.status, "active"),
                inArray(schema.assignment.assetId, ids),
              ),
            );

          await tx.insert(schema.transaction).values(
            moving.map((a: any) => ({
              tenantId: tid,
              assetId: a.id,
              eventType: "project_change",
              actorId: ctx.session.userId,
              fromState: {
                status: a.currentStatus,
                custodianId: a.currentCustodianId,
                projectId: a.currentProjectId,
                locationId: a.currentLocationId,
              },
              /* Complete snapshot — the fold is last-snapshot-wins, so a partial
                 toState would blank out custody and location. */
              toState: {
                status: a.currentStatus,
                custodianId: a.currentCustodianId,
                projectId: input.projectId,
                locationId: a.currentLocationId,
              },
              refType: "employee_project_assignment",
              refId: posting?.id ?? null,
              note: `Moved with ${person.name} to ${proj.name}`,
            })),
          );
          toolsMoved = moving.length;
        }

        /* The containers themselves re-home to the new job so the locations
           page and the register agree about where the truck works. */
        let containersMoved = 0;
        if (containerLocIds.size) {
          await tx
            .update(schema.location)
            .set({ projectId: input.projectId })
            .where(and(eq(schema.location.tenantId, tid), inArray(schema.location.id, [...containerLocIds])));
          await tx
            .update(schema.vehicle)
            .set({ projectId: input.projectId, updatedAt: new Date() })
            .where(
              and(eq(schema.vehicle.tenantId, tid), inArray(schema.vehicle.locationId, [...containerLocIds])),
            );
          containersMoved = containerLocIds.size;
        }

        return { postingId: posting?.id ?? null, toolsMoved, containersMoved };
      });

      await logEvent(ctx, {
        category: "assignment",
        action: "employee.assignToProject",
        entityType: "employee",
        entityId: input.employeeId,
        entityLabel: person.name,
        details: {
          projectId: input.projectId,
          projectName: proj.name,
          fromProjectId: person.primaryProjectId,
          startedOn,
          toolsMoved: result.toolsMoved,
          containersMoved: result.containersMoved,
        },
      });

      return { ok: true, ...result, projectName: proj.name };
    }),

  update: requirePermission("employee.manage")
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        role: z.string().max(40).optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().max(40).nullable().optional(),
        externalId: z.string().max(60).nullable().optional(),
        employmentStatus: z.string().max(30).optional(),
        reportsToEmployeeId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const { id, ...changes } = input;
      const existing = await ctx.db.query.employee.findFirst({
        where: and(eq(schema.employee.id, id), eq(schema.employee.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such person in this tenant" });

      /* `primaryProjectId` is deliberately absent. Moving somebody to a job is
         `assignToProject` — it closes their posting, opens the next and takes
         their tools with them. Editing the column here would change the answer
         without any of that happening. */
      if (changes.reportsToEmployeeId === id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Somebody cannot report to themselves." });
      }

      const patch: Record<string, unknown> = Object.fromEntries(
        Object.entries(changes).filter(([, v]) => v !== undefined),
      );
      if (!Object.keys(patch).length) return existing;

      /* Terminating from this form still has to stamp the date the clearance
         queue reads, or an ex-employee holding tools never surfaces. */
      if (patch.employmentStatus === "terminated" && existing.employmentStatus !== "terminated") {
        patch.terminatedAt = new Date();
      }
      if (patch.employmentStatus === "active" && existing.employmentStatus === "terminated") {
        patch.terminatedAt = null;
      }

      const [row] = await ctx.db
        .update(schema.employee)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(schema.employee.id, id), eq(schema.employee.tenantId, tid)))
        .returning();

      await logEvent(ctx, {
        category: "assignment", action: "employee.update", entityType: "employee",
        entityId: id, entityLabel: row?.name ?? existing.name,
        details: { changed: Object.keys(patch) },
      });
      return row;
    }),

  /*
    Somebody who has held a tool is terminated, not deleted.

    Custody history names them, and the HR clearance queue is built on knowing
    who was holding what when they left. Deleting the row nulls those links and
    the queue silently empties — which is precisely the failure this system
    exists to prevent.
  */
  delete: requirePermission("employee.manage")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.employee.findFirst({
        where: and(eq(schema.employee.id, input.id), eq(schema.employee.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such person in this tenant" });

      const [holding] = await ctx.db
        .select({ id: schema.asset.id })
        .from(schema.asset)
        .where(and(eq(schema.asset.tenantId, tid), eq(schema.asset.currentCustodianId, input.id)))
        .limit(1);
      if (holding) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "They are still holding tools. Return or transfer those first.",
        });
      }

      const [everHeld] = await ctx.db
        .select({ id: schema.assignment.id })
        .from(schema.assignment)
        .where(and(eq(schema.assignment.tenantId, tid), eq(schema.assignment.custodianId, input.id)))
        .limit(1);
      if (everHeld) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This person appears in custody history. Set them to terminated instead — deleting them would break the trail.",
        });
      }

      await ctx.db.delete(schema.employee).where(and(eq(schema.employee.id, input.id), eq(schema.employee.tenantId, tid)));
      await logEvent(ctx, {
        category: "assignment", action: "employee.delete", entityType: "employee",
        entityId: input.id, entityLabel: existing.name,
      });
      return { ok: true };
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
