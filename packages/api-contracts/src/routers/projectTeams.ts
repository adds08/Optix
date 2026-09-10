import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@stinventory/db/schema";
import { branchEmployeeIds, removalBranch, canAssignIntoTier, tiersAbove } from "@stinventory/domain";
import { protectedProcedure, router } from "../trpc.js";
import { activeProjectRows, assertBranchTarget, assertProjectAccess } from "../project-access.js";
import { visibleProjectScope } from "../scope.js";
import { projectTeamRouter, requireTeamRole, assertCanAssign } from "./projectTeam.js";
import { logEvent } from "../audit.js";

export const projectTeamsRouter = router({
  workspace: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.session.permissions.has("project.team.read")) throw new TRPCError({ code: "FORBIDDEN" });
    const tid = ctx.session.tenantId;
    const scope = await visibleProjectScope(ctx.db, ctx.session);
    const projects = await ctx.db.select({ id: schema.project.id, name: schema.project.name, code: schema.project.code }).from(schema.project).where(and(eq(schema.project.tenantId, tid), eq(schema.project.kind, "project"), ...(scope.restrict ? [inArray(schema.project.id, [...scope.ids])] : []))).orderBy(schema.project.name);
    const tiers = await ctx.db.select().from(schema.teamRole).where(eq(schema.teamRole.tenantId, tid));
    const allRows = await activeProjectRows(ctx.db, tid);
    /*
      The pickers on this screen offered a bare NAME and nothing else, which is
      unusable on a real register: 1,851 people, repeated names, and 272 options
      rendered at once. It read as "the dropdown is broken" when the list was
      fine and the rows were simply indistinguishable.

      So each person carries the two facts that tell them apart — HR's job title
      and the company's own employee code — plus the manager edge, which lets
      the client float the viewer's own direct reports to the top. The picker
      already searches its `hint` field, so the code becomes searchable for free.
    */
    const people = await ctx.db
      .select({
        id: schema.employee.id,
        name: schema.employee.name,
        code: schema.employee.code,
        jobTitle: schema.companyRole.name,
        reportsToEmployeeId: schema.employee.reportsToEmployeeId,
        status: schema.employee.employmentStatus,
        flagged: schema.employee.hrFlaggedInactiveAt,
      })
      .from(schema.employee)
      .leftJoin(schema.companyRole, eq(schema.companyRole.id, schema.employee.companyRoleId))
      .where(eq(schema.employee.tenantId, tid));
    const names = new Map(people.map(p => [p.id, p.name]));
    const peopleById = new Map(people.map(p => [p.id, p]));
    const assigners = tiers.length ? await ctx.db.select().from(schema.teamRoleAssigner).where(inArray(schema.teamRoleAssigner.teamRoleId, tiers.map(t => t.id))) : [];
    /*
      The tiers above each tier on the ladder — path 4 of `canAssignIntoTier`,
      so a Director can place a Foreman on a job she runs.

      Computed ONCE from `tiers`, which is already the tenant's whole register
      in memory, rather than per project or per tier: the walk is cheap but the
      loop below runs it for every tier of every project, and the answer never
      varies by project.

      `ancestorTierNamesFor` in `projectTeam.ts` is the same computation against
      the database, for the write gate. Both must agree — a hint that offers a
      tier the write then refuses is worse than not offering it — which is why
      both call the same `tiersAbove` rather than each deciding what "above"
      means.
    */
    const tierNameById = new Map(tiers.map(t => [t.id, t.name]));
    const ancestorsOf = new Map<string, ReadonlySet<string>>(
      tiers.map(t => [
        t.id,
        new Set(tiersAbove(tiers, t.id).map(id => tierNameById.get(id)).filter((n): n is string => !!n)),
      ]),
    );
    const result = [];
    for (const project of projects) {
      const rows = allRows.filter(r => r.projectId === project.id);
      const assignable: string[] = [];
      const callerTiers = new Set(rows.filter(r => r.employeeId === ctx.session.employeeId).map(r => r.role));
      const participates = rows.some(r => r.employeeId === ctx.session.employeeId || r.reportsToEmployeeId === ctx.session.employeeId);
      for (const tier of tiers) {
        const hasGrant = ctx.session.permissions.has("project.team.assign");
        if ((ctx.session.permissions.has("project.team.assign") || participates) && canAssignIntoTier({ hasAdminPermission: hasGrant, targetIsOpenToEveryone: tier.assignableByEveryone, callerTierNamesOnThisProject: callerTiers, targetAssignerTierNames: new Set(assigners.filter(a => a.teamRoleId === tier.id).map(a => tiers.find(t => t.id === a.assignerTeamRoleId)?.name ?? "")), targetAncestorTierNames: ancestorsOf.get(tier.id) })) assignable.push(tier.name);
      }
      const branch = ctx.session.employeeId ? branchEmployeeIds(rows, project.id, ctx.session.employeeId) : new Set<string>();
      const isDesk = ctx.session.permissions.has("project.team.assign");
      result.push({ ...project, assignable, members: rows.map(r => ({ ...r, name: names.get(r.employeeId) ?? "Unknown", label: tiers.find(t => t.name === r.role)?.label ?? r.role,
        /* CODE AND JOB TITLE ON EVERY ROSTER ROW.

           `people` above carried both and `members` carried neither, so the
           pickers named a person properly while the crew list that renders
           the SAME people showed a bare name. A person is always
           name · job title · code — one rule, and a list of rows is not an
           exception to it. */
        code: peopleById.get(r.employeeId)?.code ?? null,
        jobTitle: peopleById.get(r.employeeId)?.jobTitle ?? null,
        canManage: assignable.includes(r.role) && (isDesk || (r.employeeId !== ctx.session.employeeId && (branch.has(r.employeeId) || !r.reportsToEmployeeId))),
      })) });
    }
    return { projects: result, tiers: tiers.map(t => ({ name: t.name, label: t.label, canHoldCustody: t.canHoldCustody,
      /* WHO may fill this tier, as LABELS, for the disabled-option reason in
         the picker. The union the gate itself uses — "Set by" plus every tier
         above it on the ladder — so the sentence on screen cannot claim
         something different from what the write would accept. */
      setBy: [...new Set([
        ...assigners.filter(a => a.teamRoleId === t.id).map(a => tiers.find(x => x.id === a.assignerTeamRoleId)?.label).filter((l): l is string => !!l),
        ...tiersAbove(tiers, t.id).map(id => tiers.find(x => x.id === id)?.label).filter((l): l is string => !!l),
      ])] })), people: people.filter(p => p.status === "active" && !p.flagged).map(p => ({ id: p.id, name: p.name, code: p.code, jobTitle: p.jobTitle, reportsToEmployeeId: p.reportsToEmployeeId })), viewerEmployeeId: ctx.session.employeeId, isDesk: ctx.session.permissions.has("project.team.assign") };
  }),

  removeBranch: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), employeeId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => ctx.db.transaction(async tx => {
      const tid = ctx.session.tenantId;
      await assertBranchTarget(tx as any, ctx.session, input.projectId, input.employeeId);
      const rows = await activeProjectRows(tx as any, tid);
      const { members, employeeIds: ids } = removalBranch(rows, input.projectId, input.employeeId);
      if (!members.length) throw new TRPCError({ code: "NOT_FOUND", message: "This branch is no longer assigned." });
      for (const member of members) await assertCanAssign(tx as any, ctx.session, tid, input.projectId, await requireTeamRole(tx, tid, member.role));
      const [held] = await tx.select({ id: schema.assignment.id }).from(schema.assignment).where(and(eq(schema.assignment.tenantId, tid), eq(schema.assignment.projectId, input.projectId), inArray(schema.assignment.custodianId, ids), isNull(schema.assignment.returnedAt))).limit(1);
      if (held) throw new TRPCError({ code: "BAD_REQUEST", message: "This branch still holds tools on this project. Return or transfer those tools before removing the branch." });
      const today = new Date().toISOString().slice(0, 10);
      await tx.update(schema.projectTeamMember).set({ endedOn: today }).where(and(eq(schema.projectTeamMember.tenantId, tid), inArray(schema.projectTeamMember.id, members.map(r => r.id))));
      await tx.update(schema.employeeProjectAssignment).set({ endedOn: today }).where(and(eq(schema.employeeProjectAssignment.tenantId, tid), eq(schema.employeeProjectAssignment.projectId, input.projectId), inArray(schema.employeeProjectAssignment.employeeId, ids), isNull(schema.employeeProjectAssignment.endedOn)));
      await tx.update(schema.employee).set({ primaryProjectId: null }).where(and(eq(schema.employee.tenantId, tid), eq(schema.employee.primaryProjectId, input.projectId), inArray(schema.employee.id, ids)));
      for (const employeeId of ids) await tx.insert(schema.projectAccessRestriction).values({ tenantId: tid, projectId: input.projectId, employeeId, reason: input.reason, createdByUserId: ctx.session.userId }).onConflictDoUpdate({ target: [schema.projectAccessRestriction.tenantId, schema.projectAccessRestriction.projectId, schema.projectAccessRestriction.employeeId], set: { restoredAt: null, reason: input.reason, createdByUserId: ctx.session.userId, createdAt: new Date() } });
      await logEvent({ ...ctx, db: tx as any }, { category: "project", action: "project.team.removeBranch", entityType: "project", entityId: input.projectId, details: { employeeIds: ids, reason: input.reason } });
      return { ok: true };
    })),

  assignBranch: protectedProcedure
    .input(z.object({ sourceProjectId: z.string().uuid(), projectId: z.string().uuid(), employeeId: z.string().uuid(), reportsToEmployeeId: z.string().uuid().nullable(), moveTools: z.boolean() }))
    .mutation(async ({ ctx, input }) => ctx.db.transaction(async tx => {
      if (input.projectId === input.sourceProjectId) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a different destination project." });
      await assertProjectAccess(tx as any, ctx.session, input.sourceProjectId);
      await assertProjectAccess(tx as any, ctx.session, input.projectId);
      const rows = await activeProjectRows(tx as any, ctx.session.tenantId);
      const branch = branchEmployeeIds(rows, input.sourceProjectId, input.employeeId);
      const members = rows.filter(r => r.projectId === input.sourceProjectId && branch.has(r.employeeId));
      if (!members.length) throw new TRPCError({ code: "NOT_FOUND" });
      if (rows.some(r => r.projectId === input.projectId && branch.has(r.employeeId))) throw new TRPCError({ code: "CONFLICT", message: "Some members are already on the destination project. Review their existing assignments individually." });
      // Parent-first order lets ordinary managers extend their own branch safely.
      const ordered: typeof members = [];
      const pending = [...members];
      while (pending.length) {
        const index = pending.findIndex(r => r.employeeId === input.employeeId || ordered.some(p => p.employeeId === r.reportsToEmployeeId));
        if (index < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Correct this branch's reporting relationships first." });
        ordered.push(pending.splice(index, 1)[0]!);
      }
      for (const member of ordered) {
        await assertBranchTarget(tx as any, ctx.session, input.sourceProjectId, member.employeeId);
        await projectTeamRouter.createCaller({ ...ctx, db: tx as any }).assign({ projectId: input.projectId, employeeId: member.employeeId, role: member.role, reportsToEmployeeId: member.employeeId === input.employeeId ? input.reportsToEmployeeId : member.reportsToEmployeeId, moveTools: input.moveTools, source: "manual_entry" });
      }
      return { ok: true };
    })),
});
