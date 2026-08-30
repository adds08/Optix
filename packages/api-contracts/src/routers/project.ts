import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requirePermission, router, type Context } from "../trpc.js";
import { logEvent } from "../audit.js";
import { visibleProjectScope } from "../scope.js";
import { moveEmployeeToProject } from "../project-assign.js";
import { PROJECT_STATUSES } from "@stinventory/types";

export const projectRouter = router({
  /*
    The job list, filtered server-side to what the caller may see.

    `visibleProjectScope` is the one gate: owners and the equipment department
    (project.manage) see every job; everyone else sees the union of their job
    groups and the projects their team row names. This is what stops a foreman
    typing a URL from reading every job in the tenant — the decision happens
    here, not in the client.
  */
  list: protectedProcedure.query(async ({ ctx }) => {
    const scope = await visibleProjectScope(ctx.db, ctx.session);
    const conds = [eq(schema.project.tenantId, ctx.session.tenantId)];
    if (scope.restrict) {
      if (scope.ids.size === 0) return [];
      conds.push(inArray(schema.project.id, [...scope.ids]));
    }
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
      .where(and(...conds))
      /* UI-74, the same defect as the register in asset.list: with no ORDER BY
         a job created a moment ago came back in heap order, so it surfaced
         wherever Postgres happened to put it rather than where somebody who
         just created it would look. Newest first. */
      .orderBy(desc(schema.project.createdAt));
  }),

  create: requirePermission("project.manage")
    .input(
      z.object({
        name: z.string().min(1).max(200),
        externalId: z.string().optional(),
        /* Same enum as `update` — a job could otherwise be BORN with a status
           no screen understands, which no amount of validation on update
           would ever catch. */
        status: z.enum(PROJECT_STATUSES).optional(),
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
        /* STI-105: was `z.string().max(30)`, so "compleet" — or any other
           string — was a valid job status and every screen that switches on
           it silently fell through. PROJECT_STATUSES already existed in
           packages/types and nothing referenced it. The DB column is plain
           text, so this enum is the only thing that stops a bad write. */
        status: z.enum(PROJECT_STATUSES).optional(),
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

      /*
        A job cannot be completed while tools are still out on it (STI-105).

        Completing is the desk's way of saying "this job is finished". If a
        foreman is still holding twenty tools booked to it, completing strands
        them: the register keeps naming a job nobody is working, and the
        "what did this job spend" report stops matching what is physically
        still on site. The ledger is what gets asked, so the ACTIVE ASSIGNMENT
        is what this counts — not `asset.current_project_id`, which is a
        projection of it.

        Deliberately a refusal rather than a bulk hand-back. Moving custody
        from here would be a SECOND way to write custody, which is the most
        expensive pattern this codebase has paid for (CLAUDE.md non-negotiable
        2) — the desk moves the tools through the surfaces that already do it
        correctly, then completes the job.
      */
      if (changes.status === "complete" && existing.status !== "complete") {
        const held = await ctx.db
          .select({ tag: schema.asset.tag, assetId: schema.assignment.assetId })
          .from(schema.assignment)
          .innerJoin(schema.asset, eq(schema.asset.id, schema.assignment.assetId))
          .where(
            and(
              eq(schema.assignment.tenantId, tid),
              eq(schema.assignment.projectId, id),
              eq(schema.assignment.status, "active"),
            ),
          );

        if (held.length) {
          /* Name a few, so the desk knows where to start rather than being
             told a number and left to find them. */
          const sample = held.slice(0, 3).map((h) => h.tag ?? "untagged").join(", ");
          const more = held.length > 3 ? `, and ${held.length - 3} more` : "";
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              `${held.length} tool${held.length === 1 ? " is" : "s are"} still out on this job (${sample}${more}). ` +
              `Move ${held.length === 1 ? "it" : "them"} to another job or back to the yard before completing it — ` +
              `completing now would leave ${held.length === 1 ? "it" : "them"} booked to a finished job.`,
          });
        }
      }

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

/*
  A `roleId` arriving from a client must be proved to belong to this tenant
  BEFORE it is written.

  Found in the audit of this change, not by a test: `employee.update` took the
  id as a bare uuid, and the `user_role` sync then wrote it straight into the
  table `resolveSession` reads — and that read has no tenant predicate of its
  own, because until now nothing could put a foreign role there. The result was
  cross-tenant privilege escalation reachable by anyone holding
  `employee.manage`: point a person at another tenant's `owner` role and their
  next request carries that role's permissions.

  `user.setRole` has always guarded this (`requireTenantRole`); the new writer
  did not. A system role — `tenant_id IS NULL` — is shared by every tenant by
  design and is allowed, exactly as it is there.
*/
async function assertRoleInTenant(db: Context["db"], tid: string, roleId: string) {
  const [row] = await db
    .select({ id: schema.role.id })
    .from(schema.role)
    .where(
      and(
        eq(schema.role.id, roleId),
        or(eq(schema.role.tenantId, tid), isNull(schema.role.tenantId)),
      ),
    )
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No such role in this tenant" });
}

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
        primaryProjectExternalId: schema.project.externalId,
        reportsToEmployeeId: schema.employee.reportsToEmployeeId,
        reportsToName: reportsTo.name,
        /* The role register, and the three facts about the PERSON that come
           with it. `roleNeedsLogin` is what lets the register tell "nobody has
           invited them yet" apart from "they will never sign in" — without it
           every labourer reads as an outstanding task forever. */
        roleId: schema.employee.roleId,
        roleName: schema.role.name,
        roleNeedsLogin: schema.role.needsLogin,
        /*
          The account, joined in rather than listed on a second screen.

          `/admin/users` was a separate register of the same people, which is
          the thing that confused everyone: a person and their login are one
          subject. `userId` null means no account exists at all; the two
          timestamps are what turn that into a real answer — invited but never
          verified, verified but never used, or live.
        */
        userId: schema.user.id,
        userIsActive: schema.user.isActive,
        emailVerifiedAt: schema.user.emailVerifiedAt,
        lastSignInAt: schema.user.lastSignInAt,
      })
      .from(schema.employee)
      .leftJoin(schema.project, eq(schema.employee.primaryProjectId, schema.project.id))
      .leftJoin(reportsTo, eq(schema.employee.reportsToEmployeeId, reportsTo.id))
      .leftJoin(schema.role, eq(schema.employee.roleId, schema.role.id))
      /* One account per person by construction — `user.employeeId` is how an
         account names its person, and nothing creates two. A left join is safe
         here for that reason; if that ever stops being true this multiplies. */
      .leftJoin(schema.user, eq(schema.user.employeeId, schema.employee.id))
      .where(eq(schema.employee.tenantId, ctx.session.tenantId))
      /* UI-73. Heap order put a new hire at whatever offset the row landed on —
         with 45 people and a 25-row page, page two — so "the employee does not
         appear in the People list" was true of the only page anybody looked at.
         Newest first. */
      .orderBy(desc(schema.employee.createdAt));
  }),

  create: requirePermission("employee.manage")
    .input(
      z.object({
        name: z.string().min(1).max(200),
        /* Legacy enum, still written so the import spec and anything not yet
           moved over keep working. `roleId` is the one that means something. */
        role: z.string().default("foreman"),
        roleId: z.string().uuid().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        primaryProjectId: z.string().uuid().optional(),
        externalId: z.string().optional(),
        employmentStatus: z.string().optional(),
        reportsToEmployeeId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.roleId) await assertRoleInTenant(ctx.db, ctx.session.tenantId, input.roleId);
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
      /*
        Everything is one transaction in the shared engine (project-assign.ts):
        close the posting, open the next, catch up primaryProjectId, move the
        tools and the trucks/trailers that carry them, and keep the person's
        project_team_member row in lockstep. This used to live here; it moved
        so project.team.assign can perform the same move for a foreman without
        the two paths drifting.
      */
      const result = await moveEmployeeToProject(ctx.db, {
        tenantId: ctx.session.tenantId,
        employeeId: input.employeeId,
        projectId: input.projectId,
        actorUserId: ctx.session.userId,
        startedOn: input.startedOn,
        note: input.note,
        moveTools: input.moveTools,
        leaveContainers: input.leaveContainers,
        role: "auto",
      });

      await logEvent(ctx, {
        category: "assignment",
        action: "employee.assignToProject",
        entityType: "employee",
        entityId: input.employeeId,
        entityLabel: result.employeeName,
        details: {
          projectId: input.projectId,
          projectName: result.projectName,
          startedOn: input.startedOn,
          toolsMoved: result.toolsMoved,
          containersMoved: result.containersMoved,
        },
      });

      return {
        ok: true,
        postingId: result.postingId,
        toolsMoved: result.toolsMoved,
        containersMoved: result.containersMoved,
        projectName: result.projectName,
      };
    }),

  update: requirePermission("employee.manage")
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        role: z.string().max(40).optional(),
        roleId: z.string().uuid().nullable().optional(),
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
      if (changes.roleId) await assertRoleInTenant(ctx.db, tid, changes.roleId);

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

      /*
        The role lives on the PERSON, and the account inherits it.

        `user_role` is what `resolveSession` reads, so changing somebody's role
        here without touching it would leave the register saying "office admin"
        while their session still held a foreman's permissions — the register
        and the truth disagreeing silently, which is the exact failure mode the
        old two-role split produced and this change exists to end.

        One transaction with the employee write: a role change that half-applied
        would be worse than one that failed. `user_role` is REPLACED rather than
        added to, because a person has one role — the table is a many-to-many
        for historical reasons and nothing in this product grants two.

        Accounts with no person are untouched: they have no `employee` row to
        change, and `user.setRole` remains the way to move those.
      */
      const roleChanged = "roleId" in patch && patch.roleId !== existing.roleId;

      const [row] = await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(schema.employee)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(schema.employee.id, id), eq(schema.employee.tenantId, tid)))
          .returning();

        if (roleChanged) {
          const [account] = await tx
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(and(eq(schema.user.employeeId, id), eq(schema.user.tenantId, tid)))
            .limit(1);
          if (account) {
            await tx.delete(schema.userRole).where(eq(schema.userRole.userId, account.id));
            if (patch.roleId) {
              await tx
                .insert(schema.userRole)
                .values({ userId: account.id, roleId: patch.roleId as string })
                .onConflictDoNothing();
            }
          }
        }
        return [updated];
      });

      await logEvent(ctx, {
        category: "assignment", action: "employee.update", entityType: "employee",
        entityId: id, entityLabel: row?.name ?? existing.name,
        details: { changed: Object.keys(patch), roleSynced: roleChanged },
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

  /*
    The foremen in this person's crew — the same edge `scope.ts crewOf` resolves,
    asked the same way, so the "my foremen" picker and the crew visibility tier
    can never disagree (2026-08-23: both now derive from the PROJECT TEAM, not
    from `reportsToEmployeeId`). A superintendent's crew is the foremen on the
    projects they are a superintendent of; `scope.ts crewOf` carries the full
    rationale and the one-level-deep rule.
  */
  myForemen: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.session.employeeId) return [];
    const tid = ctx.session.tenantId;
    const employeeId = ctx.session.employeeId;

    const supers = await ctx.db
      .select({ projectId: schema.projectTeamMember.projectId })
      .from(schema.projectTeamMember)
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, tid),
          eq(schema.projectTeamMember.employeeId, employeeId),
          eq(schema.projectTeamMember.role, "superintendent"),
          isNull(schema.projectTeamMember.endedOn),
        ),
      );
    if (supers.length === 0) return [];

    const projectIds = supers.map((s) => s.projectId);
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
      .innerJoin(
        schema.projectTeamMember,
        and(
          eq(schema.projectTeamMember.employeeId, schema.employee.id),
          eq(schema.projectTeamMember.tenantId, tid),
          eq(schema.projectTeamMember.role, "foreman"),
          isNull(schema.projectTeamMember.endedOn),
          inArray(schema.projectTeamMember.projectId, projectIds),
        ),
      )
      .where(and(eq(schema.employee.tenantId, tid), eq(schema.employee.employmentStatus, "active")));
  }),
});
