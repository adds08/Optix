/** A reporting branch is project-specific; a lower title alone conveys no relationship. */
export type BranchMember = { employeeId: string; projectId: string; reportsToEmployeeId: string | null };
export function branchEmployeeIds(rows: readonly BranchMember[], projectId: string, rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.projectId === projectId && row.reportsToEmployeeId && ids.has(row.reportsToEmployeeId) && !ids.has(row.employeeId)) {
        ids.add(row.employeeId);
        changed = true;
      }
    }
  }
  return ids;
}

/** End only access that depended on this branch; a separately assigned parent keeps its branch alive. */
export function removalBranch<T extends BranchMember & { id: string }>(rows: readonly T[], projectId: string, rootId: string) {
  const projectRows = rows.filter(r => r.projectId === projectId);
  const removed = new Set(projectRows.filter(r => r.employeeId === rootId).map(r => r.id));
  let changed = true;
  while (changed) {
    changed = false;
    const gone = new Set(projectRows.filter(r => removed.has(r.id)).map(r => r.employeeId).filter(id => projectRows.filter(r => r.employeeId === id).every(r => removed.has(r.id))));
    for (const row of projectRows) if (row.reportsToEmployeeId && gone.has(row.reportsToEmployeeId) && !removed.has(row.id)) { removed.add(row.id); changed = true; }
  }
  const members = projectRows.filter(r => removed.has(r.id));
  const employeeIds = [...new Set(members.map(r => r.employeeId))].filter(id => projectRows.filter(r => r.employeeId === id).every(r => removed.has(r.id)));
  return { members, employeeIds };
}
