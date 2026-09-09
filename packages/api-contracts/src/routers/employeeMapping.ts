import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@stinventory/db/schema";
import { requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { BAMBOO_JOB_TITLES } from "../bamboo-job-titles.js";

export const employeeMappingRouter = router({
  list: requirePermission("config.manage").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const mappings = await ctx.db.select().from(schema.employeeRoleMapping).where(eq(schema.employeeRoleMapping.tenantId, tid));
    const employees = await ctx.db.select({ id: schema.employee.id, name: schema.employee.name, roleId: schema.employee.roleId, jobTitle: schema.companyRole.name, department: schema.department.name, status: schema.employee.employmentStatus, flagged: schema.employee.hrFlaggedInactiveAt }).from(schema.employee).leftJoin(schema.companyRole, eq(schema.companyRole.id, schema.employee.companyRoleId)).leftJoin(schema.department, eq(schema.department.id, schema.employee.departmentId)).where(eq(schema.employee.tenantId, tid));
    const titles = [...new Set<string>([...BAMBOO_JOB_TITLES, ...employees.flatMap(e => e.jobTitle ? [e.jobTitle] : [])])].sort();
    return { titles, mappings, employees, departments: [...new Set(employees.flatMap(e => e.department ? [e.department] : []))].sort() };
  }),
  save: requirePermission("config.manage")
    .input(z.object({ jobTitle: z.string().trim().min(1).max(200), department: z.string().max(200).default(""), roleId: z.string().uuid().nullable(), disposition: z.enum(["review", "mapped", "no_login"]) }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      if (input.disposition === "mapped" && !input.roleId) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an Optix role." });
      if (input.roleId) {
        const role = await ctx.db.query.role.findFirst({ where: and(eq(schema.role.id, input.roleId), or(eq(schema.role.tenantId, tid), isNull(schema.role.tenantId))) });
        if (!role) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a role in this company." });
      }
      await ctx.db.insert(schema.employeeRoleMapping).values({ ...input, tenantId: tid, updatedByUserId: ctx.session.userId }).onConflictDoUpdate({ target: [schema.employeeRoleMapping.tenantId, schema.employeeRoleMapping.jobTitle, schema.employeeRoleMapping.department], set: { roleId: input.roleId, disposition: input.disposition, updatedByUserId: ctx.session.userId, updatedAt: new Date() } });
      await logEvent(ctx, { category: "auth", action: "employee.mapping.save", entityType: "role_mapping", entityLabel: input.jobTitle, details: input });
      return { ok: true };
    }),
  applyMapping: requirePermission("user.manage")
    .input(z.object({ mappingId: z.string().uuid(), employeeIds: z.array(z.string().uuid()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session.permissions.has("config.manage")) throw new TRPCError({ code: "FORBIDDEN" });
      const tid = ctx.session.tenantId;
      return ctx.db.transaction(async tx => {
        const mapping = await tx.query.employeeRoleMapping.findFirst({ where: and(eq(schema.employeeRoleMapping.id, input.mappingId), eq(schema.employeeRoleMapping.tenantId, tid)) });
        if (!mapping || mapping.disposition !== "mapped" || !mapping.roleId) throw new TRPCError({ code: "BAD_REQUEST", message: "Save an approved role mapping first." });
        const employees = await tx.select({ id: schema.employee.id, title: schema.companyRole.name, department: schema.department.name, flagged: schema.employee.hrFlaggedInactiveAt, status: schema.employee.employmentStatus }).from(schema.employee).leftJoin(schema.companyRole, eq(schema.companyRole.id, schema.employee.companyRoleId)).leftJoin(schema.department, eq(schema.department.id, schema.employee.departmentId)).where(and(eq(schema.employee.tenantId, tid), inArray(schema.employee.id, input.employeeIds)));
        if (employees.length !== new Set(input.employeeIds).size || employees.some(e => e.title !== mapping.jobTitle || (mapping.department && e.department !== mapping.department) || e.flagged || e.status !== "active")) throw new TRPCError({ code: "CONFLICT", message: "Some employees no longer match or are inactive. Refresh and review the selection." });
        const privileged = await tx.select().from(schema.rolePermission).where(and(eq(schema.rolePermission.roleId, mapping.roleId), inArray(schema.rolePermission.permissionName, ["user.manage", "config.manage"])));
        if (privileged.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Assign administrative roles individually from People after reviewing the account." });
        const accounts = await tx.select({ id: schema.user.id }).from(schema.user).where(and(eq(schema.user.tenantId, tid), inArray(schema.user.employeeId, input.employeeIds)));
        // Never let a bulk mapping demote existing administrators or the actor.
        const adminAccounts = accounts.length ? await tx.select({ userId: schema.userRole.userId }).from(schema.userRole).innerJoin(schema.rolePermission, eq(schema.rolePermission.roleId, schema.userRole.roleId)).where(and(inArray(schema.userRole.userId, accounts.map(a => a.id)), inArray(schema.rolePermission.permissionName, ["user.manage", "config.manage"]))) : [];
        if (adminAccounts.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Review administrative accounts individually before changing their role." });
        await tx.update(schema.employee).set({ roleId: mapping.roleId, updatedAt: new Date() }).where(and(eq(schema.employee.tenantId, tid), inArray(schema.employee.id, input.employeeIds)));
        for (const account of accounts) { await tx.delete(schema.userRole).where(eq(schema.userRole.userId, account.id)); await tx.insert(schema.userRole).values({ userId: account.id, roleId: mapping.roleId }); }
        await logEvent({ ...ctx, db: tx as any }, { category: "auth", action: "employee.mapping.apply", entityType: "role_mapping", entityId: mapping.id, details: { employeeIds: input.employeeIds, roleId: mapping.roleId } });
        return { ok: true };
      });
    }),
});
