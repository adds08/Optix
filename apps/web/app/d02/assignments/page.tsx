"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Can } from "@/components/can";
import { useToast } from "@/components/d02/d02-toast";
import {
  ClipboardList, Plus, RotateCcw, ArrowRightLeft, AlertOctagon, CheckCircle2
} from "lucide-react";
import { AssignForm } from "@/components/assign-form";
import { TransferForm } from "@/components/transfer-form";

function StatusChip({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "d02-chip-active",
    overdue: "d02-chip-overdue",
    pending_approval: "d02-chip-maintenance",
  };
  return <span className={`d02-chip ${colors[status] ?? ""}`}>{status.replace("_", " ")}</span>;
}

export default function D02AssignmentsPage() {
  const a = trpc.assignment.list.useQuery();
  const utils = trpc.useUtils();
  const { has } = usePermissions();
  const toast = useToast();
  const assignments = a.data ?? [];

  const overdue = assignments.filter((x) => x.overdue);
  const loans = assignments.filter((x) => x.type === "temporary" && !x.overdue);
  const permanent = assignments.filter((x) => x.type === "permanent");

  const [showAssign, setShowAssign] = useState(false);
  const [showTransfer, setShowTransfer] = useState<{ id: string; tag: string } | null>(null);
  const [returning, setReturning] = useState<string | null>(null);

  const doReturn = async (assignmentId: string) => {
    setReturning(assignmentId);
    try {
      await utils.client.assignment.return.mutate({ id: assignmentId });
      toast("ok", "Tool returned successfully");
      utils.assignment.list.invalidate();
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
      utils.dashboard.recentActivity.invalidate();
    } catch (e: any) {
      toast("err", e.message ?? "Return failed");
    }
    setReturning(null);
  };

  return (
    <div className="d02-card" style={{ padding: 0 }}>
      <h2><ClipboardList size={16} className="d02-card-header-icon" /> All Assignments ({assignments.length})</h2>

      {overdue.length > 0 && (
        <div className="d02-alert d02-alert-danger" style={{ margin: "14px 18px", marginBottom: 0 }}>
          <AlertOctagon />
          <span><b>{overdue.length} overdue loan{overdue.length > 1 ? "s" : ""}</b> — tools that should have been returned</span>
        </div>
      )}

      <div className="d02-toolbar">
        <Can perm="assignment.create">
          <button className="d02-btn d02-sm" onClick={() => setShowAssign(true)}><Plus size={14} /> Assign</button>
        </Can>
        <div style={{ flex: 1 }} />
        <span className="d02-chip" style={{ fontSize: 12 }}>{loans.length} loans · {permanent.length} permanent</span>
      </div>

      <div className="d02-body d02-scroll">
        <table className="d02-table">
          <thead><tr>
            <th>Tool</th><th>Custodian</th><th>Project</th><th>Type</th><th>Since</th><th>Due</th><th>Status</th>
            <th>Actions</th>
          </tr></thead>
          <tbody>
            {assignments.map((x) => (
              <tr key={x.id} className={x.overdue ? "d02-row-overdue" : ""}>
                <td><b>{x.tag}</b><br /><span className="d02-id">{x.modelName}</span></td>
                <td>{x.custodianName}</td>
                <td>{x.projectName ?? <span className="d02-muted">—</span>}</td>
                <td>{x.type === "temporary" ? <span className="d02-chip d02-chip-loan">loan</span> : <span className="d02-chip">permanent</span>}</td>
                <td>{x.startDate}</td>
                <td>{x.expectedEnd ?? <span className="d02-muted">—</span>}</td>
                <td>{x.overdue ? <StatusChip status="overdue" /> : <StatusChip status={x.status} />}</td>
                <td>
                  <div className="d02-actions">
                    {x.status === "active" && has("assignment.create") && (
                      <>
                        <button className="d02-btn d02-ghost d02-sm" onClick={() => doReturn(x.id)} disabled={returning === x.id}>
                          {returning === x.id ? "..." : <RotateCcw size={14} />}
                        </button>
                        <button className="d02-btn d02-ghost d02-sm" onClick={() => setShowTransfer({ id: x.assetId, tag: x.tag })}>
                          <ArrowRightLeft size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!assignments.length && (
              <tr><td colSpan={8}><div className="d02-empty"><CheckCircle2 size={36} /><div>No assignments yet</div></div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <AssignForm open={showAssign} onClose={() => setShowAssign(false)} />
      {showTransfer && <TransferForm open={!!showTransfer} onClose={() => setShowTransfer(null)} assetId={showTransfer.id} assetTag={showTransfer.tag} />}
    </div>
  );
}
