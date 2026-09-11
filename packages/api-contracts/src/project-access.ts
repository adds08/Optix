import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import { branchEmployeeIds } from "@stinventory/domain";
import type { Database } from "@stinventory/db";
import type { ResolvedSession } from "@stinventory/auth";
import { TRPCError } from "@trpc/server";

export async function activeProjectRows(db: Database, tenantId: string) {
  /*
    ORDERED, because an unordered roster is not a stable fact.

    This is the single source of every members array on the Crew screens, and it
    carried no `ORDER BY` — so Postgres returned the same rows in whatever order
    it liked, and two identical reads could disagree. That surfaced as
    `account-lifecycle.test.ts` comparing the roster before and after an
    onboarding reopen and failing on nothing: same three people, shuffled. It
    failed for `project_manager` and passed for the other three roles in the
    same `it.each`, which is the signature of order luck rather than a
    regression. On screen the same gap let a crew list reshuffle between page
    loads.

    `createdAt` then `id`, the tie-break rule this codebase already follows for
    the ledger: a bulk writer inserts many rows inside one timestamp, so the
    timestamp alone does not order them.
  */
  return db.select().from(schema.projectTeamMember)
    .where(and(eq(schema.projectTeamMember.tenantId, tenantId), isNull(schema.projectTeamMember.endedOn)))
    .orderBy(schema.projectTeamMember.createdAt, schema.projectTeamMember.id);
}
export async function restrictedProjects(db: Database, session: ResolvedSession) {
  if (!session.employeeId) return new Set<string>();
  const rows = await db.select({ projectId: schema.projectAccessRestriction.projectId }).from(schema.projectAccessRestriction)
    .where(and(eq(schema.projectAccessRestriction.tenantId, session.tenantId), eq(schema.projectAccessRestriction.employeeId, session.employeeId), isNull(schema.projectAccessRestriction.restoredAt)));
  return new Set(rows.map(r => r.projectId));
}
export async function assertProjectAccess(db: Database, session: ResolvedSession, projectId: string) {
  if ((await restrictedProjects(db, session)).has(projectId)) throw new TRPCError({ code: "FORBIDDEN", message: "Your access to this project was removed. Ask your manager to restore it." });
  if (session.permissions.has("project.team.assign")) return;
  if (!session.employeeId) throw new TRPCError({ code: "FORBIDDEN", message: "You are not assigned to this project." });
  const rows = await activeProjectRows(db, session.tenantId);
  const branch = branchEmployeeIds(rows, projectId, session.employeeId);
  if (!rows.some(r => r.projectId === projectId && branch.has(r.employeeId))) throw new TRPCError({ code: "FORBIDDEN", message: "You do not manage a branch on this project." });
}
export async function assertBranchTarget(db: Database, session: ResolvedSession, projectId: string, employeeId: string, parentId?: string | null) {
  await assertProjectAccess(db, session, projectId);
  if (session.permissions.has("project.team.assign")) return;
  const rows = await activeProjectRows(db, session.tenantId);
  const ownBranch = branchEmployeeIds(rows, projectId, session.employeeId!);
  const existing = rows.some(r => r.projectId === projectId && r.employeeId === employeeId);
  if (employeeId === session.employeeId || (existing && !ownBranch.has(employeeId) && rows.some(r => r.projectId === projectId && r.employeeId === employeeId && r.reportsToEmployeeId))) throw new TRPCError({ code: "FORBIDDEN", message: "You may manage your reporting branch, not yourself or another manager's team." });
  if (parentId !== undefined && (!parentId || !ownBranch.has(parentId) || parentId === employeeId)) throw new TRPCError({ code: "FORBIDDEN", message: "Choose a manager within your reporting branch." });
}
