/*
  The organisation chart (pure).

  Inputs are roster rows the caller has already read and tenant-scoped; nothing
  here touches a database. The chart is a VIEW over `project_team_member` — the
  same rows the Tools by Jobsite hub and the People screen write — so there is
  no second store to keep in step and no synchronisation step to get wrong.

  THE ONLY EDGE IS `reportsToEmployeeId`. There is deliberately no rank on a
  role: a rank asserts one company-wide ladder ("a PM always outranks a
  superintendent"), and this is sold to construction firms whose structures
  differ from each other and drift inside a single firm. Recording who answers
  to whom, per roster row, asserts nothing and can represent any shape — an
  engineer over a superintendent, a PM acting as area in-charge on the one job
  in his patch, a foreman reporting straight to a director on a small job.
*/

/** A roster row, reduced to what the chart needs. */
export type OrgMemberInput = {
  /** `project_team_member.id` — the node's identity. */
  id: string;
  projectId: string;
  employeeId: string;
  /** The team role on this job: pm, superintendent, foreman, or whatever the
      tenant has added. Free text on purpose — see the schema comment. */
  role: string;
  reportsToEmployeeId: string | null;
};

export type OrgNode<T extends OrgMemberInput> = {
  /** Stable key. Real rows use the row id; a person reached only by being
      pointed at gets `person:<employeeId>` — see `SYNTHETIC_PREFIX`. */
  key: string;
  employeeId: string;
  /** Null on a synthetic node: a director pointed at from forty jobs holds no
      row of their own on any of them. */
  member: T | null;
  projectId: string | null;
  children: OrgNode<T>[];
  /** Depth from the root of its tree, 0-based. Handy for indentation and for
      the "collapse below level N" control. */
  depth: number;
};

export const SYNTHETIC_PREFIX = "person:";

const keyOf = (m: OrgMemberInput) => m.id;
const syntheticKey = (employeeId: string) => `${SYNTHETIC_PREFIX}${employeeId}`;

/*
  Which node is the parent of a row that reports to employee `E`.

  Preferring E's row on the SAME project is what makes the chart read like the
  job does: the foreman on Lone Star hangs off the superintendent of Lone Star,
  not off the same person's row on a different job. Only when E holds no row on
  this project do we fall back to a single synthetic node for E, which is the
  case that lets one director sit above forty jobs without forty rows saying so.
*/
function resolveParentKey<T extends OrgMemberInput>(
  row: T,
  byEmployee: Map<string, T[]>,
): string | null {
  const target = row.reportsToEmployeeId;
  if (!target) return null;
  const rows = byEmployee.get(target);
  if (!rows || rows.length === 0) return syntheticKey(target);
  const sameProject = rows.find((r) => r.projectId === row.projectId);
  return sameProject ? keyOf(sameProject) : syntheticKey(target);
}

/**
 * Build the forest. Returns one tree per root — a row reporting to nobody, or
 * to somebody who is not in `members` (a leaver whose rows have closed).
 *
 * Cycle-tolerant by construction: a row already placed is never placed again,
 * so a mis-entered A -> B -> A cannot produce infinite recursion or a hung
 * page. Rows stranded in a cycle surface via `findCycle`, which is what the
 * write path uses to refuse creating one in the first place.
 */
export function buildOrgForest<T extends OrgMemberInput>(members: T[]): OrgNode<T>[] {
  const byEmployee = new Map<string, T[]>();
  for (const m of members) {
    const list = byEmployee.get(m.employeeId) ?? [];
    list.push(m);
    byEmployee.set(m.employeeId, list);
  }

  const nodes = new Map<string, OrgNode<T>>();
  for (const m of members) {
    nodes.set(keyOf(m), {
      key: keyOf(m),
      employeeId: m.employeeId,
      member: m,
      projectId: m.projectId,
      children: [],
      depth: 0,
    });
  }

  /* Synthetic nodes for people who are pointed at but hold no row of their
     own — created before linking so a parent always exists by the time a child
     looks for it. */
  const parentKeyByRow = new Map<string, string | null>();
  for (const m of members) {
    const pk = resolveParentKey(m, byEmployee);
    parentKeyByRow.set(keyOf(m), pk);
    if (pk && pk.startsWith(SYNTHETIC_PREFIX) && !nodes.has(pk)) {
      nodes.set(pk, {
        key: pk,
        employeeId: pk.slice(SYNTHETIC_PREFIX.length),
        member: null,
        projectId: null,
        children: [],
        depth: 0,
      });
    }
  }

  /*
    Break cycles BEFORE linking, so the children graph handed to the renderer is
    guaranteed acyclic. Tolerating a cycle downstream is not enough: `a` reports
    to `b` and `b` to `a` would otherwise produce `a.children = [b]` and
    `b.children = [a]`, and the first recursive walk over that — ours, or a
    component rendering subtrees — never returns.

    One edge is cut per loop, at the row where the walk re-enters itself, so the
    rest of the chain still renders and everybody stays visible. The write path
    refuses to create a cycle at all (`findCycle`); this is what keeps the screen
    up for rows that predate the guard or arrived another way.
  */
  const walkState = new Map<string, "done">();
  for (const m of members) {
    const start = keyOf(m);
    if (walkState.get(start) === "done") continue;
    const path: string[] = [];
    const inPath = new Set<string>();
    let cur: string | null = start;
    while (cur && walkState.get(cur) !== "done") {
      if (inPath.has(cur)) {
        parentKeyByRow.set(cur, null);
        break;
      }
      inPath.add(cur);
      path.push(cur);
      const pk: string | null = parentKeyByRow.get(cur) ?? null;
      cur = pk && nodes.has(pk) ? pk : null;
    }
    for (const k of path) walkState.set(k, "done");
  }

  const roots: OrgNode<T>[] = [];
  const placed = new Set<string>();
  for (const m of members) {
    const node = nodes.get(keyOf(m))!;
    const pk = parentKeyByRow.get(keyOf(m)) ?? null;
    const parent = pk ? nodes.get(pk) : undefined;
    if (!parent || parent.key === node.key) {
      roots.push(node);
      continue;
    }
    parent.children.push(node);
    placed.add(node.key);
  }
  /* Synthetic nodes are never anybody's child — nothing points at them except
     the rows that created them — so every one of them is a root. */
  for (const node of nodes.values()) {
    if (node.member === null) roots.push(node);
  }

  /* A cycle leaves its members parented to each other and reachable from no
     root. Surface them rather than dropping them silently: a person missing
     from the chart with no explanation is worse than one shown at top level. */
  const reachable = new Set<string>();
  const setDepth = (node: OrgNode<T>, depth: number) => {
    if (reachable.has(node.key)) return;
    reachable.add(node.key);
    node.depth = depth;
    for (const c of node.children) setDepth(c, depth + 1);
  };
  for (const r of roots) setDepth(r, 0);
  for (const node of nodes.values()) {
    if (!reachable.has(node.key)) {
      roots.push(node);
      setDepth(node, 0);
    }
  }

  return roots;
}

/**
 * Every employee visible to `viewerEmployeeId`: their own chain upward, and
 * everybody beneath them. Siblings are NOT included — a superintendent sees the
 * PM above and their own crew below, not the next superintendent's crew.
 *
 * This is an ACCESS RULE and belongs on the server. Do not reimplement it by
 * filtering in a browser: that ships every row to every client first.
 */
export function visibleEmployeeIds(
  members: OrgMemberInput[],
  viewerEmployeeId: string,
): Set<string> {
  const visible = new Set<string>([viewerEmployeeId]);

  /* Up: follow reportsTo from every row the viewer holds. Bounded by `seen`,
     so a cycle terminates instead of looping. */
  const parentsOf = new Map<string, Set<string>>();
  const childrenOf = new Map<string, Set<string>>();
  for (const m of members) {
    if (!m.reportsToEmployeeId) continue;
    const ps = parentsOf.get(m.employeeId) ?? new Set<string>();
    ps.add(m.reportsToEmployeeId);
    parentsOf.set(m.employeeId, ps);
    const cs = childrenOf.get(m.reportsToEmployeeId) ?? new Set<string>();
    cs.add(m.employeeId);
    childrenOf.set(m.reportsToEmployeeId, cs);
  }

  const walk = (start: string, edges: Map<string, Set<string>>) => {
    const queue = [start];
    const seen = new Set<string>([start]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of edges.get(cur) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        visible.add(next);
        queue.push(next);
      }
    }
  };

  walk(viewerEmployeeId, parentsOf);
  walk(viewerEmployeeId, childrenOf);
  return visible;
}

/**
 * Would making `employeeId` report to `wouldReportTo` close a loop?
 *
 * Returns the chain that proves it (starting at `wouldReportTo` and arriving
 * back at `employeeId`), or null when the edge is safe. The write path refuses
 * on a non-null result: `project.ts` already rejects the depth-1 case
 * ("Somebody cannot report to themselves") and this is the same rule at any
 * depth, which is the one that actually bites — A -> B -> C -> A is entered one
 * innocent row at a time by three different people.
 */
export function findCycle(
  members: OrgMemberInput[],
  employeeId: string,
  wouldReportTo: string | null,
): string[] | null {
  if (!wouldReportTo) return null;
  if (wouldReportTo === employeeId) return [employeeId, employeeId];

  const parentsOf = new Map<string, Set<string>>();
  for (const m of members) {
    if (!m.reportsToEmployeeId) continue;
    const ps = parentsOf.get(m.employeeId) ?? new Set<string>();
    ps.add(m.reportsToEmployeeId);
    parentsOf.set(m.employeeId, ps);
  }

  /* Depth-first from the proposed boss upward. Reaching `employeeId` means the
     new edge would close the loop. */
  const stack: { at: string; path: string[] }[] = [{ at: wouldReportTo, path: [wouldReportTo] }];
  const seen = new Set<string>();
  while (stack.length) {
    const { at, path } = stack.pop()!;
    if (at === employeeId) return path;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const p of parentsOf.get(at) ?? []) {
      stack.push({ at: p, path: [...path, p] });
    }
  }
  return null;
}
