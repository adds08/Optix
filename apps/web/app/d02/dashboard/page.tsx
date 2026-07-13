"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Can } from "@/components/can";
import { useToast } from "@/components/d02/d02-toast";
import {
  Wrench, CheckCircle2, AlertTriangle, Bookmark, SearchX, DollarSign, AlertOctagon,
  Clock, Activity, ThumbsUp, Plus, Check
} from "lucide-react";
import { ProjectForm } from "@/components/project-form";

const money = (n: string | null | undefined) => "$" + Number(n ?? 0).toLocaleString();

function LoadSkeleton({ n, type }: { n: number; type: "kpi" | "table" }) {
  return type === "kpi" ? (
    <div className="d02-kpis">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="d02-kpi-card">
          <div className="d02-skeleton d02-skeleton-card" />
        </div>
      ))}
    </div>
  ) : (
    <div style={{ padding: 18 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="d02-skeleton d02-skeleton-table-row" style={{ width: `${70 + Math.random() * 30}%` }} />
      ))}
    </div>
  );
}

function EmptyState({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="d02-empty">
      {icon}
      <div>{title}</div>
      {action}
    </div>
  );
}

export default function D02DashboardPage() {
  const k = trpc.dashboard.kpis.useQuery();
  const overdue = trpc.dashboard.overdueLoans.useQuery();
  const activity = trpc.dashboard.recentActivity.useQuery();
  const clearance = trpc.dashboard.clearanceQueue.useQuery();
  const pending = trpc.dashboard.pendingApprovals.useQuery();
  const utils = trpc.useUtils();
  const { has } = usePermissions();
  const toast = useToast();
  const [showProjectForm, setShowProjectForm] = useState(false);

  if (!k.data) return <LoadSkeleton n={6} type="kpi" />;

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
      toast("ok", `${type === "assignment" ? "Assignment" : "Transfer"} approved`);
    } catch (e: any) {
      toast("err", e.message ?? "Approval failed");
    }
  };

  const kpiData = [
    { key: "assigned", n: k.data.assigned, l: "In Use", icon: <Wrench />, style: "blue" as const },
    { key: "available", n: k.data.available, l: "Available", icon: <CheckCircle2 />, style: "ok" as const },
    { key: "inMaintenance", n: k.data.inMaintenance, l: "In Repair", icon: <AlertTriangle />, style: "warn" as const },
    { key: "reserved", n: k.data.reserved, l: "Reserved", icon: <Bookmark />, style: "warn" as const },
    ...(k.data.lost > 0 ? [{ key: "lost", n: k.data.lost, l: "Lost", icon: <SearchX />, style: "bad" as const }] : []),
    { key: "fleetValue", n: money(k.data.fleetValue), l: "Fleet Value", icon: <DollarSign />, style: "blue" as const },
  ];

  return (
    <>
      <div className="d02-toolbar" style={{ background: "#fff", borderRadius: "var(--d2-radius)", marginBottom: 18, boxShadow: "var(--d2-card-shadow)" }}>
        <Can perm="project.manage">
          <button className="d02-btn d02-sm" onClick={() => setShowProjectForm(true)}><Plus size={14} /> New Project</button>
        </Can>
        <div style={{ flex: 1 }} />
        <span className="d02-chip" style={{ fontSize: 12 }}>{k.data.available} available / {k.data.assigned} assigned</span>
      </div>

      <div className="d02-alerts">
        {overdue.data?.length ? (
          <div className="d02-alert d02-alert-danger">
            <AlertOctagon />
            <span><b>{overdue.data.length} overdue</b> temporary loan{overdue.data.length > 1 ? "s" : ""} — <a href="/d02/assignments">review now</a></span>
          </div>
        ) : null}
        {clearance.data?.length ? (
          <div className="d02-alert d02-alert-warn">
            <AlertTriangle />
            <span><b>{clearance.data.length} asset{clearance.data.length > 1 ? "s" : ""}</b> pending HR clearance (terminated foreman)</span>
          </div>
        ) : null}
        {k.data.lost > 0 ? (
          <div className="d02-alert d02-alert-danger">
            <SearchX />
            <span><b>{k.data.lost} lost</b> asset{k.data.lost > 1 ? "s" : ""} — <a href="/d02/assets">audit trail</a></span>
          </div>
        ) : null}
      </div>

      <div className="d02-kpis">
        {kpiData.map((kpi) => (
          <div key={kpi.key} className={`d02-kpi-card d02-kpi-${kpi.style}`}>
            <div className="d02-kpi-icon">{kpi.icon}</div>
            <div className="d02-kpi-n">{kpi.n}</div>
            <div className="d02-kpi-l">{kpi.l}</div>
          </div>
        ))}
      </div>

      <div className="d02-grid2">
        {pending.data?.length && has("assignment.approve") ? (
          <div className="d02-card">
            <h2><ThumbsUp size={16} className="d02-card-header-icon" /> Pending Approvals</h2>
            <div className="d02-body d02-scroll">
              <table className="d02-table"><thead><tr><th>Tool</th><th>Custodian</th><th>Type</th><th>Action</th></tr></thead>
                <tbody>
                  {pending.data.map((p) => (
                    <tr key={`${p.type}-${p.id}`}>
                      <td><b>{p.assetTag}</b><br /><span className="d02-id">{p.assetModel}</span></td>
                      <td>{p.custodianName}</td>
                      <td><span className="d02-chip">{p.type}</span></td>
                      <td><button className="d02-btn d02-sm d02-ok" onClick={() => doApprove(p.type, p.id)}><Check size={14} /> Approve</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="d02-card">
          <h2><Clock size={16} className="d02-card-header-icon" /> Overdue Loans</h2>
          <div className="d02-body d02-scroll">
            {overdue.data?.length ? (
              <table className="d02-table"><thead><tr><th>Tool</th><th>Custodian</th><th>Due</th><th>Overdue</th></tr></thead>
                <tbody>
                  {overdue.data.map((o) => (
                    <tr key={o.id} className="d02-row-overdue">
                      <td><b>{o.tag}</b><br /><span className="d02-id">{o.modelName}</span></td>
                      <td>{o.custodianName}<br /><span className="d02-id">#{o.custodianExternalId ?? "—"}</span></td>
                      <td>{o.expectedEnd}</td>
                      <td><span className="d02-chip d02-chip-overdue">{o.daysOverdue}d overdue</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={<CheckCircle2 />} title="All clear — no overdue loans" />
            )}
          </div>
        </div>

        <div className="d02-card">
          <h2><Activity size={16} className="d02-card-header-icon" /> Recent Movements</h2>
          <div className="d02-body">
            <ul className="d02-feed">
              {activity.data?.length ? activity.data.map((t) => (
                <li key={t.id}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="d02-chip">{t.eventType.replace("_", " ")}</span>
                    <b>{t.assetTag}</b>
                  </span>
                  <span className="d02-muted" style={{ fontSize: 12 }}>{t.note}</span>
                  <span className="d02-t">{new Date(t.occurredAt).toLocaleString()}</span>
                </li>
              )) : (
                <li><EmptyState icon={<Activity />} title="No recent activity" /></li>
              )}
            </ul>
          </div>
        </div>
      </div>

      <ProjectForm open={showProjectForm} onClose={() => setShowProjectForm(false)} />
    </>
  );
}
