import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import type { ResolvedSession } from "@stinventory/auth";
import { VIEW_SCOPES, type ViewScope } from "@stinventory/types";

/*
  The visibility ladder (STI-302) — the one gate every scoped read goes
  through, so "how much of the register may this user see" is decided by the
  API, not by whatever the client chooses to filter.

  SYSTEM_PLAN §6.3 specifies four tiers, resolved in order, first match wins:

      assets.view.all      equipment desk, admins, the back office
      assets.view.project  PM, Engineer   — the jobs they are on the team of
      assets.view.crew     Superintendent — the foremen reporting to them
      assets.view.own      Foreman, Mechanic — what is in their own hands

  What this replaced, and why it mattered: scoping used to be a BINARY split
  keyed off `project.manage` — hold it and you saw everything, lack it and you
  saw your own projects. A superintendent and a foreman were therefore
  indistinguishable to the scoping layer, and anyone granted `project.manage`
  for an unrelated reason silently got the desk's view of every tool Urban
  owns. The tier is a permission now, not a role name and not a side effect of
  a different permission (SYSTEM_PLAN §9).

  Two rules that are not negotiable here:

  1. AN ACTOR HOLDING NONE OF THE FOUR SEES NOTHING — and "nothing" is an
     empty result, never an unscoped one. Every function below returns a
     never-true predicate rather than `undefined` for that case. `undefined`
     reads as "no filter" to Drizzle's `and()`, so the difference between
     "sees nothing" and "sees everything" is one dropped branch.

  2. AUTHORISATION IS APPLIED TO THE QUERY, NEVER AS A POST-FILTER ON RESULTS
     (SYSTEM_PLAN §7, §9 — §7 calls it non-negotiable). Filtering rows after
     they are read leaks existence through counts, totals and pagination: a
     dashboard tile that says "312 tools" and then shows you four has told you
     about 308 tools you may not see.

  Tenant scoping is untouched and stacks on top: every caller still carries
  `eq(table.tenantId, tid)`. The ladder narrows WITHIN a tenant; it never
  replaces the tenant predicate. There is no RLS — the WHERE clause is the
  isolation.
*/

export type ViewTier = ViewScope | "none";

/* Resolved once per request by `assetVisibility` and handed to the helpers
   below. `custodianIds` and `projectIds` are already expanded — the walk up
   the reporting chain and out to project membership happens once, not per
   query. */
export type AssetScope =
  | { tier: "assets.view.all" }
  | { tier: "assets.view.project"; projectIds: string[] }
  | { tier: "assets.view.crew"; custodianIds: string[] }
  | { tier: "assets.view.own"; custodianIds: string[] }
  | { tier: "none" };

/* A predicate that is false for every row, used wherever a tier resolves to an
   empty set. Written as SQL rather than as `eq(col, "")` so it cannot
   accidentally match a real value, and so an EXPLAIN shows plainly that the
   query was intended to return nothing. */
const MATCHES_NOTHING = sql`false`;

/** The highest tier the actor holds, or "none". Order is VIEW_SCOPES'. */
export function viewTierOf(session: ResolvedSession): ViewTier {
  for (const scope of VIEW_SCOPES) {
    if (session.permissions.has(scope)) return scope;
  }
  return "none";
}

/*
  Foremen reporting to this person, plus the person themselves.

  A superintendent holds tools of their own as well as overseeing a crew, so
  omitting `self` here would hide a superintendent's own tools from the
  superintendent — which is what "crew" meant before anyone wrote it down.

  One level deep, deliberately. `employee.myForemen` (routers/project.ts) walks
  the same edge and stops at the same place; Urban's structure is
  PM -> superintendent -> foreman, and a recursive walk would let a mis-set
  `reportsToEmployeeId` cycle quietly widen someone's view. If a deeper chain
  ever becomes real, change it here and in `myForemen` together — they are the
  same question asked twice.
*/
async function crewOf(db: Database, tid: string, employeeId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.employee.id })
    .from(schema.employee)
    .where(and(eq(schema.employee.tenantId, tid), eq(schema.employee.reportsToEmployeeId, employeeId)));
  return [employeeId, ...rows.map((r) => r.id)];
}

/*
  Projects this account may see: the union of the job groups handed to the
  login account and the projects their employee record is on the team of.

  Both sources are kept because they answer different questions. A group is
  something an administrator hands out ("you cover the north jobs"); a team row
  is a fact about the work ("Dana runs Lone Star"). A PM can legitimately have
  either, and before the ladder existed a PM with neither saw nothing at all.
*/
async function projectsOf(db: Database, session: ResolvedSession): Promise<string[]> {
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

  return [...ids];
}

/**
 * Resolve the actor's tier and expand it into concrete ids. Call once per
 * procedure and pass the result to the `*Where` helpers below.
 */
export async function assetVisibility(db: Database, session: ResolvedSession): Promise<AssetScope> {
  const tier = viewTierOf(session);

  if (tier === "assets.view.all") return { tier };
  if (tier === "none") return { tier: "none" };

  /* Every tier below `all` is a statement about a PERSON, and an account with
     no employee record is not a person — it is a business login (Office
     Administrator, a service account). Such an account cannot be on a project
     team and cannot have a crew, so the honest answer is "nothing", not
     "everything". Roles that genuinely need the whole register hold
     `assets.view.all` and never reach this line. */
  if (!session.employeeId) return { tier: "none" };

  if (tier === "assets.view.project") {
    return { tier, projectIds: await projectsOf(db, session) };
  }
  if (tier === "assets.view.crew") {
    return { tier, custodianIds: await crewOf(db, session.tenantId, session.employeeId) };
  }
  return { tier: "assets.view.own", custodianIds: [session.employeeId] };
}

/**
 * The ladder as a predicate on the `asset` table. `undefined` means "no
 * narrowing needed" and is returned ONLY for `assets.view.all`; every other
 * outcome is a real condition, including the never-true one.
 *
 * AND this with the tenant predicate — it does not carry one.
 */
export function assetScopeWhere(scope: AssetScope) {
  switch (scope.tier) {
    case "assets.view.all":
      return undefined;
    case "assets.view.project":
      /* Tools with no project are the yard's — a PM has no claim on them, so
         they are excluded rather than shown to everyone. This is why the
         predicate is a plain inArray and not an `or(isNull(...))`. */
      return scope.projectIds.length
        ? inArray(schema.asset.currentProjectId, scope.projectIds)
        : MATCHES_NOTHING;
    case "assets.view.crew":
    case "assets.view.own":
      return scope.custodianIds.length
        ? inArray(schema.asset.currentCustodianId, scope.custodianIds)
        : MATCHES_NOTHING;
    case "none":
      return MATCHES_NOTHING;
  }
}

/**
 * The same ladder expressed against a joined `assignment` row, for the custody
 * queries that read assignments rather than the asset projection.
 *
 * It reads the ASSIGNMENT's own custodian/project rather than the asset's,
 * because a returned assignment is history: the asset has moved on, and
 * scoping the history by where the tool is *now* would show a foreman a
 * hand-off he was never part of, and hide one he was.
 */
export function assignmentScopeWhere(scope: AssetScope) {
  switch (scope.tier) {
    case "assets.view.all":
      return undefined;
    case "assets.view.project":
      return scope.projectIds.length
        ? inArray(schema.assignment.projectId, scope.projectIds)
        : MATCHES_NOTHING;
    case "assets.view.crew":
    case "assets.view.own":
      return scope.custodianIds.length
        ? inArray(schema.assignment.custodianId, scope.custodianIds)
        : MATCHES_NOTHING;
    case "none":
      return MATCHES_NOTHING;
  }
}

export type ProjectScope = { restrict: boolean; ids: Set<string> };

/*
  Project visibility, derived from the same ladder so the two cannot disagree.

  This is the older of the two gates and it keeps its shape because
  `project.list` and `projectTeam` consume `{restrict, ids}` directly. What
  changed is what decides it: `project.manage` used to, which meant the yard
  desk's ability to EDIT a project was also what made every project VISIBLE to
  them — two different questions answered by one grant.

  The crew tier resolves to the jobs the crew are actually working, so a
  superintendent's job list matches the tools they can see. Deriving it from
  the crew's assets rather than from their postings would be circular; the
  posting is the fact, the tools follow it.
*/
export async function visibleProjectScope(db: Database, session: ResolvedSession): Promise<ProjectScope> {
  const scope = await assetVisibility(db, session);

  if (scope.tier === "assets.view.all") return { restrict: false, ids: new Set() };
  if (scope.tier === "none") return { restrict: true, ids: new Set() };
  if (scope.tier === "assets.view.project") return { restrict: true, ids: new Set(scope.projectIds) };

  /* crew and own: the jobs the people in scope are posted to, plus any groups
     or team rows the account itself carries. A foreman on Lone Star sees Lone
     Star; a superintendent whose crew spans two jobs sees both. */
  const tid = session.tenantId;
  const ids = new Set(await projectsOf(db, session));

  const rows = await db
    .select({ projectId: schema.employeeProjectAssignment.projectId })
    .from(schema.employeeProjectAssignment)
    .where(
      and(
        eq(schema.employeeProjectAssignment.tenantId, tid),
        inArray(schema.employeeProjectAssignment.employeeId, scope.custodianIds),
        isNull(schema.employeeProjectAssignment.endedOn),
      ),
    );
  for (const r of rows) ids.add(r.projectId);

  /* A crew member's primary project counts too — `employee.primaryProjectId`
     is set for people the posting table has no open row for, and a
     superintendent who could not see their own foreman's job would be looking
     at that foreman's tools with no way to open the job they are on. */
  const primaries = await db
    .select({ projectId: schema.employee.primaryProjectId })
    .from(schema.employee)
    .where(and(eq(schema.employee.tenantId, tid), inArray(schema.employee.id, scope.custodianIds)));
  for (const r of primaries) if (r.projectId) ids.add(r.projectId);

  return { restrict: true, ids };
}

/* Re-exported for the routers that build their own `or(...)` around the
   ladder — notably the ones that must also let a user see a row they are the
   ACTOR on, regardless of tier. */
export { or, MATCHES_NOTHING };
