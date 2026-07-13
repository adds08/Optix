"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Can } from "@/components/can";
import { TransferForm } from "@/components/transfer-form";
import { AssignForm } from "@/components/assign-form";

function statusChip(s: string) {
  return <span className={`chip ${s}`}>{s.replace("_", " ")}</span>;
}

export default function AssignmentsPage() {
  const a = trpc.assignment.list.useQuery();
  const utils = trpc.useUtils();
  const { has } = usePermissions();
  const assignments = a.data ?? [];

  const overdue = assignments.filter((x) => x.overdue);
  const loans = assignments.filter((x) => x.type === "temporary" && !x.overdue);
  const permanent = assignments.filter((x) => x.type === "permanent");

  const [showTransfer, setShowTransfer] = useState<{ id: string; tag: string } | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [returning, setReturning] = useState<string | null>(null);

  const doReturn = async (assignmentId: string) => {
    setReturning(assignmentId);
    try {
      await utils.client.assignment.return.mutate({ id: assignmentId });
      utils.assignment.list.invalidate();
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
      utils.dashboard.recentActivity.invalidate();
    } catch {}
    setReturning(null);
  };

  return (
    <div className="assign-page">
      <div className="assign-header">
        <p><b>Assignments</b> track who currently has each tool. A <b>permanent</b> assignment means the
        custodian keeps the tool until it's returned. A <b>temporary loan</b> has a due date — if the
        tool isn't returned by then, it's flagged <span className="chip overdue">overdue</span>.</p>
      </div>

      {overdue.length > 0 && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <b>{overdue.length} overdue loan{overdue.length > 1 ? "s" : ""}</b> — tools that should have been returned
        </div>
      )}

      <div className="toolbar" style={{ gap: 8, padding: "8px 14px", display: "flex" }}>
        <Can perm="assignment.create">
          <button className="btn btn-sm" onClick={() => setShowAssign(true)}>+ Assign</button>
        </Can>
      </div>

      <div className="card">
        <h2>All Assignments ({assignments.length})</h2>
        <div className="body scroll">
          <table>
            <thead><tr>
              <th>Tool</th><th>Custodian</th><th>Project</th><th>Type</th><th>Since</th><th>Due</th><th>Status</th>
              <th>Actions</th>
            </tr></thead>
            <tbody>
              {assignments.map((x) => (
                <tr key={x.id} className={x.overdue ? "row-overdue" : ""}>
                  <td><b>{x.tag}</b><br /><span className="muted">{x.modelName}</span></td>
                  <td>{x.custodianName}</td>
                  <td>{x.projectName ?? <span className="muted">—</span>}</td>
                  <td>{x.type === "temporary" ? <span className="chip">loan</span> : "permanent"}</td>
                  <td>{x.startDate}</td>
                  <td>{x.expectedEnd ?? <span className="muted">—</span>}</td>
                  <td>{x.overdue ? statusChip("overdue") : statusChip(x.status)}</td>
                  <td>
                    {x.status === "active" && has("assignment.create") && (
                      <>
                        <button className="btn btn-sm ghost" onClick={() => doReturn(x.id)} disabled={returning === x.id} style={{ marginRight: 4 }}>
                          {returning === x.id ? "..." : "Return"}
                        </button>
                        <button className="btn btn-sm ghost" onClick={() => setShowTransfer({ id: x.assetId, tag: x.tag })}>Transfer</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!assignments.length && (
                <tr><td colSpan={8} className="muted" style={{ padding: 14 }}>No assignments</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showTransfer && <TransferForm open={!!showTransfer} onClose={() => setShowTransfer(null)} assetId={showTransfer.id} assetTag={showTransfer.tag} />}
      <AssignForm open={showAssign} onClose={() => setShowAssign(false)} />
    </div>
  );
}
