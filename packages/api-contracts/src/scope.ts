import { and, eq, inArray, isNull } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import type { ResolvedSession } from "@stinventory/auth";

/*
  Server-side project visibility — the one gate every project-reading query
  goes through, so "which jobs may this user see" is decided by the API, not
  by whatever the client chooses to filter.

  Two sources of authorization, unioned:

    1. Job groups handed to the login account (project_group_user) — a
       superintendent or PM who has been put in a group sees its jobs.
    2. Projects the person is on the team for (project_team_member) — a
       foreman linked to Legacy West sees Legacy West. This is the same rule
       the Tools by Jobsite hub displays: linked foreman = working there.

  Users holding `project.manage` (owners, the equipment department) are global
  and see everything — the desk keeps full access, and everyone else sees only
  what they were put on. A scoped user with no assignments sees nothing, which
  is the secure default.
*/

export type ProjectScope = { restrict: boolean; ids: Set<string> };

export async function visibleProjectScope(db: Database, session: ResolvedSession): Promise<ProjectScope> {
  if (session.permissions.has("project.manage")) {
    return { restrict: false, ids: new Set() };
  }

  const tid = session.tenantId;
  const ids = new Set<string>();

  const groups = await db
    .select({ id: schema.projectGroup.id })
    .from(schema.projectGroup)
    .innerJoin(schema.projectGroupUser, eq(schema.projectGroupUser.projectGroupId, schema.projectGroup.id))
    .where(and(eq(schema.projectGroup.tenantId, tid), eq(schema.projectGroupUser.userId, session.userId)));

  if (groups.length) {
    const rows = await db
      .select({ projectId: schema.projectGroupProject.projectId })
      .from(schema.projectGroupProject)
      .where(
        and(
          eq(schema.projectGroupProject.tenantId, tid),
          inArray(
            schema.projectGroupProject.projectGroupId,
            groups.map((g) => g.id),
          ),
        ),
      );
    for (const r of rows) ids.add(r.projectId);
  }

  if (session.employeeId) {
    const rows = await db
      .select({ projectId: schema.projectTeamMember.projectId })
      .from(schema.projectTeamMember)
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, tid),
          eq(schema.projectTeamMember.employeeId, session.employeeId),
          isNull(schema.projectTeamMember.endedOn),
        ),
      );
    for (const r of rows) ids.add(r.projectId);
  }

  return { restrict: true, ids };
}
