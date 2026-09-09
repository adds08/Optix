import { activeProjectRows, restrictedProjects } from "./project-access.js";
import { and, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import type { ResolvedSession } from "@stinventory/auth";
import { VIEW_SCOPES, type ViewScope } from "@stinventory/types";
import { branchEmployeeIds, tiersAtOrBelow } from "@stinventory/domain";

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
export type AssetScope = (
  | { tier: "assets.view.all" }
  | { tier: "assets.view.project"; projectIds: string[] }
  | { tier: "assets.view.crew"; custodianIds: string[]; ownEmployeeId?: string; branches?: { projectId: string; custodianIds: string[] }[] }
  | { tier: "assets.view.own"; custodianIds: string[] }
  | { tier: "none" }) & { excludedProjectIds?: string[] };

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
  Foremen in this person's crew, plus the person themselves.

  A superintendent holds tools of their own as well as overseeing a crew, so
  omitting `self` here would hide a superintendent's own tools from the
  superintendent — which is what "crew" meant before anyone wrote it down.

  THE EDGE, AND WHY IT CHANGED (2026-08-23): the crew used to be
  `employee.reportsToEmployeeId = actor` — a manual org-chart link, editable
  by nobody in particular and able to disagree with the roster. The user's
  operating rule is simpler and is now the only source: a foreman on a project
  IS working it, so a superintendent's crew is the foremen on the projects the
  superintendent is on the team of. "All supers on a job see that job's
  foremen", decided at planning. `reportsToEmployeeId` remains a display field
  on the employee record; it is no longer read for scoping here, in
  `myForemen`, or in the departure successor.

  NO LONGER ONE LEVEL DEEP (changed 2026-09-08). It used to hardcode
  `superintendent` above and `foreman` below, on the stated grounds that
  "Urban's structure is PM -> superintendent -> foreman" and that a deeper
  chain would be dealt with when it became real. It became real: the tier
  register ships `director -> area_in_charge -> {pm, general_superintendent} ->
  superintendent -> foreman`, and against that the old code resolved an area
  in-charge or a general superintendent holding `assets.view.crew` to
  `[self]` — they saw their own tools and nothing else, with no error and
  nothing on screen to say why. A silent empty result is the worst possible
  failure for a visibility rule.

  THE RULE IS UNCHANGED, only generalised. The user's decision at planning was
  "all supers on a job see that job's foremen" — that is, your crew is the
  people in a tier BELOW yours, on the jobs you are on the team of. Both halves
  of that sentence are now read from the register instead of assumed: which
  tiers are below you comes from `tiersAtOrBelow`, and which jobs are yours
  comes from your own roster rows.

  For a superintendent the result is byte-for-byte what it was — the tiers
  below `superintendent` are exactly `{foreman}` — so this widens nothing for
  the roles that already worked.

  PER PROJECT, not pooled. A person can hold different tiers on different jobs
  (superintendent on one, foreman on another), and their crew on the second is
  correctly empty. Pooling the projects first, as the old code did, would have
  leaked the first job's foremen into the second job's answer the moment
  anybody held two different tiers.

  `employee.myForemen` (routers/project.ts) is the same question asked twice
  and now calls this, so the two cannot drift again.
*/
export async function crewEmployeeIds(
  db: Database,
  tid: string,
  employeeId: string,
): Promise<string[]> {
  const rows = await activeProjectRows(db, tid);
  const out = new Set<string>();
  for (const projectId of new Set(rows.map(r => r.projectId))) {
    for (const id of branchEmployeeIds(rows, projectId, employeeId)) if (id !== employeeId) out.add(id);
  }
  return [...out];
}

async function crewOf(db: Database, tid: string, employeeId: string): Promise<string[]> {
  /* The actor is always in their own crew scope — `assets.view.crew` has never
     meant "everything except mine". */
  return [employeeId, ...(await crewEmployeeIds(db, tid, employeeId))];
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
    const rows = await activeProjectRows(db, tid);
    for (const projectId of new Set(rows.map(r => r.projectId))) {
      const branch = branchEmployeeIds(rows, projectId, session.employeeId);
      if (rows.some(r => r.projectId === projectId && branch.has(r.employeeId))) ids.add(projectId);
    }
  }
  for (const id of await restrictedProjects(db, session)) ids.delete(id);

  return [...ids];
}

/**
 * Resolve the actor's tier and expand it into concrete ids. Call once per
 * procedure and pass the result to the `*Where` helpers below.
 */
async function resolveAssetVisibility(db: Database, session: ResolvedSession): Promise<AssetScope> {
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
    const rows = await activeProjectRows(db, session.tenantId);
    const branches = [...new Set(rows.map(r => r.projectId))].map(projectId => ({ projectId, custodianIds: [...branchEmployeeIds(rows, projectId, session.employeeId!)].filter(id => id !== session.employeeId) })).filter(b => b.custodianIds.length);
    return { tier, ownEmployeeId: session.employeeId, branches, custodianIds: [session.employeeId, ...new Set(branches.flatMap(b => b.custodianIds))] };
  }
  return { tier: "assets.view.own", custodianIds: [session.employeeId] };
}

export async function assetVisibility(db: Database, session: ResolvedSession): Promise<AssetScope> {
  const scope = await resolveAssetVisibility(db, session);
  return { ...scope, excludedProjectIds: [...await restrictedProjects(db, session)] };
}

/**
 * The ladder as a predicate on the `asset` table. `undefined` means "no
 * narrowing needed" and is returned ONLY for `assets.view.all`; every other
 * outcome is a real condition, including the never-true one.
 *
 * AND this with the tenant predicate — it does not carry one.
 */
function assetScopePredicate(scope: AssetScope) {
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
      if (scope.branches && scope.ownEmployeeId) return or(eq(schema.asset.currentCustodianId, scope.ownEmployeeId), ...scope.branches.map(b => and(eq(schema.asset.currentProjectId, b.projectId), inArray(schema.asset.currentCustodianId, b.custodianIds))));
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
function assignmentScopePredicate(scope: AssetScope) {
  switch (scope.tier) {
    case "assets.view.all":
      return undefined;
    case "assets.view.project":
      return scope.projectIds.length
        ? inArray(schema.assignment.projectId, scope.projectIds)
        : MATCHES_NOTHING;
    case "assets.view.crew":
      if (scope.branches && scope.ownEmployeeId) return or(eq(schema.assignment.custodianId, scope.ownEmployeeId), ...scope.branches.map(b => and(eq(schema.assignment.projectId, b.projectId), inArray(schema.assignment.custodianId, b.custodianIds))));
    case "assets.view.own":
      return scope.custodianIds.length
        ? inArray(schema.assignment.custodianId, scope.custodianIds)
        : MATCHES_NOTHING;
    case "none":
      return MATCHES_NOTHING;
  }
}

export function assetScopeWhere(scope: AssetScope) {
  const excluded = scope.excludedProjectIds ?? [];
  return and(assetScopePredicate(scope), excluded.length ? or(isNull(schema.asset.currentProjectId), notInArray(schema.asset.currentProjectId, excluded)) : undefined);
}
export function assignmentScopeWhere(scope: AssetScope) {
  const excluded = scope.excludedProjectIds ?? [];
  return and(assignmentScopePredicate(scope), excluded.length ? or(isNull(schema.assignment.projectId), notInArray(schema.assignment.projectId, excluded)) : undefined);
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
  const denied = await restrictedProjects(db, session);
  if (session.permissions.has("assets.view.all") || session.permissions.has("project.team.assign")) {
    if (!denied.size) return { restrict: false, ids: new Set() };
    const projects = await db.select({ id: schema.project.id }).from(schema.project).where(eq(schema.project.tenantId, session.tenantId));
    return { restrict: true, ids: new Set(projects.map(p => p.id).filter(id => !denied.has(id))) };
  }
  return { restrict: true, ids: new Set(await projectsOf(db, session)) };
}

/* Re-exported for the routers that build their own `or(...)` around the
   ladder — notably the ones that must also let a user see a row they are the
   ACTOR on, regardless of tier. */
export { or, MATCHES_NOTHING };
