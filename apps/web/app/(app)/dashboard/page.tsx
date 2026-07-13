"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Can } from "@/components/can";
import { ProjectForm } from "@/components/project-form";

function statusChip(s: string) {
  return <span className={`chip ${s}`}>{s.replace("_", " ")}</span>;
}
const money = (n: string | null | undefined) => "$" + Number(n ?? 0).toLocaleString();

export default function DashboardPage() {
  const k = trpc.dashboard.kpis.useQuery();
  const overdue = trpc.dashboard.overdueLoans.useQuery();
  const activity = trpc.dashboard.recentActivity.useQuery();
  const clearance = trpc.dashboard.clearanceQueue.useQuery();
  const pending = trpc.dashboard.pendingApprovals.useQuery();
  const utils = trpc.useUtils();
  const { has } = usePermissions();
  const [showProjectForm, setShowProjectForm] = useState(false);

  if (!k.data) return <div className="muted">Loading…</div>;

  const doApprove = async (type: string, id: string) => {
    try {
      if (type === "assignment") await utils.client.assignment.approve.mutate({ id });
      else await utils.client.transfer.approve.mutate({ id });
      pending.refetch();
      utils.assignment.list.invalidate();
      utils.transfer.list.invalidate();
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
      utils.dashboard.recentActivity.invalidate();
    } catch {}
  };

  return (
    <div className="dash">
      <div className="toolbar" style={{ gap: 8, padding: "8px 14px", display: "flex" }}>
        <Can perm="project.manage">
          <button className="btn btn-sm" onClick={() => setShowProjectForm(true)}>+ New Project</button>
        </Can>
      </div>
      <div className="alerts">
        {overdue.data?.length ? (
          <div className="alert alert-danger">
            <b>{overdue.data.length} overdue</b> temporary loan{overdue.data.length > 1 ? "s" : ""} —
            <a href="/assignments"> review now</a>
          </div>
        ) : null}
        {clearance.data?.length ? (
          <div className="alert alert-warn">
            <b>{clearance.data.length} asset{clearance.data.length > 1 ? "s" : ""}</b> pending HR clearance
            (terminated foreman)
          </div>
        ) : null}
        {k.data.lost > 0 ? (
          <div className="alert alert-danger">
            <b>{k.data.lost} lost</b> asset{k.data.lost > 1 ? "s" : ""} —
            <a href="/assets"> audit trail</a>
          </div>
        ) : null}
      </div>

      <div className="kpis">
        <div className="kpi"><div className="n">{k.data.assigned}</div><div className="l">In Use</div></div>
        <div className="kpi okk"><div className="n">{k.data.available}</div><div className="l">Available</div></div>
        <div className="kpi warnk"><div className="n">{k.data.inMaintenance}</div><div className="l">In Repair</div></div>
        <div className="kpi warnk"><div className="n">{k.data.reserved}</div><div className="l">Reserved</div></div>
        {k.data.lost > 0 ? (
          <div className="kpi alert"><div className="n">{k.data.lost}</div><div className="l">Lost</div></div>
        ) : null}
        <div className="kpi"><div className="n">{money(k.data.fleetValue)}</div><div className="l">Fleet Value</div></div>
      </div>

      <div className="grid2">
        {pending.data?.length && has("assignment.approve") ? (
          <div className="card">
            <h2>Pending Approvals</h2>
            <div className="body scroll">
              <table><thead><tr><th>Tool</th><th>Custodian</th><th>Type</th><th>Action</th></tr></thead>
                <tbody>
                  {pending.data.map((p) => (
                    <tr key={`${p.type}-${p.id}`}>
                      <td><b>{p.assetTag}</b><br /><span className="id">{p.assetModel}</span></td>
                      <td>{p.custodianName}</td>
                      <td><span className="chip">{p.type}</span></td>
                      <td><button className="btn btn-sm btn-ok" onClick={() => doApprove(p.type, p.id)}>Approve</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="card">
          <h2>⚠ Overdue Loans (temporary)</h2>
          <div className="body scroll">
            {overdue.data?.length ? (
              <table><thead><tr><th>Tool</th><th>Custodian</th><th>Due</th><th>Overdue</th></tr></thead>
                <tbody>
                  {overdue.data.map((o) => (
                    <tr key={o.id} className="row-overdue">
                      <td><b>{o.tag}</b><br /><span className="id">{o.modelName}</span></td>
                      <td>{o.custodianName}<br /><span className="id">#{o.custodianExternalId ?? "—"}</span></td>
                      <td>{o.expectedEnd}</td>
                      <td><span className="chip overdue">{o.daysOverdue}d</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty">All clear — no overdue loans</div>}
          </div>
        </div>
        <div className="card">
          <h2>Recent Movements</h2>
          <div className="body"><ul className="feed">
            {activity.data?.map((t) => (
              <li key={t.id}>
                <span className="chip">{t.eventType.replace("_", " ")}</span>
                {" "}{t.assetTag}<br />
                <span className="muted">{t.note}</span>
                <span className="t"> {new Date(t.occurredAt).toLocaleString()}</span>
              </li>
            ))}
          </ul></div>
        </div>
      </div>
      <ProjectForm open={showProjectForm} onClose={() => setShowProjectForm(false)} />
    </div>
  );
}
