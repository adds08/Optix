"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Can } from "@/components/can";
import { useToast } from "@/components/d02/d02-toast";
import { Users, Plus, Star, Users2, CheckCircle2, UserPlus } from "lucide-react";
import { EmployeeForm } from "@/components/employee-form";

const money = (n: string | null | undefined) => "$" + Number(n ?? 0).toLocaleString();

export default function D02ForemenPage() {
  const employees = trpc.employee.list.useQuery();
  const me = trpc.identity.me.useQuery();
  const myEmployeeId = me.data?.employeeId ?? null;
  const isSuper = me.data?.role === "superintendent";
  const foremen = employees.data?.filter((e) => e.role === "foreman") ?? [];
  const assets = trpc.asset.list.useQuery();
  const { has } = usePermissions();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);

  const isMyForeman = (f: { reportsToEmployeeId: string | null }) =>
    isSuper && !!myEmployeeId && f.reportsToEmployeeId === myEmployeeId;

  const visible = onlyMine && isSuper ? foremen.filter(isMyForeman) : foremen;

  return (
    <>
      <div className="d02-toolbar" style={{ background: "#fff", borderRadius: "var(--d2-radius)", marginBottom: 18, boxShadow: "var(--d2-card-shadow)" }}>
        <Can perm="employee.manage">
          <button className="d02-btn d02-sm d02-ok" onClick={() => setShowForm(true)}><UserPlus size={14} /> New Employee</button>
        </Can>
        <div style={{ flex: 1 }} />
        {isSuper && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Users2 size={14} /> My Foremen only</span>
          </label>
        )}
        <span className="d02-chip">{foremen.length} foremen</span>
      </div>

      {visible.map((f) => {
        const held = assets.data?.filter((a) => a.custodianId === f.id && a.status !== "available") ?? [];
        const val = held.reduce((s, x) => s + Number(x.acquisitionCost ?? 0), 0);
        const projs = new Set(held.map((h) => h.currentProjectName).filter(Boolean));
        const mine = isMyForeman(f);
        return (
          <div className="d02-card" key={f.id} style={mine ? { borderLeft: "4px solid var(--d2-ok)" } : undefined}>
            <h2>
              <Users size={16} className="d02-card-header-icon" />
              {f.name} {f.employmentStatus === "terminated" ? <span className="d02-chip d02-chip-lost">terminated</span> : null}
              {f.reportsToName ? <span className="d02-chip" style={{ marginLeft: 8 }}>Reports to {f.reportsToName}</span> : null}
              {mine ? <span className="d02-chip d02-chip-ok" style={{ marginLeft: 8 }}><Star size={12} /> My foreman</span> : null}
            </h2>
            <div className="d02-toolbar" style={{ background: "#fafbfc" }}>
              <span className="d02-chip">Primary: {f.primaryProjectName ?? "—"}</span>
              <span className="d02-chip">{held.length} tools</span>
              <span className="d02-chip">{money(val.toString())}</span>
              <span className="d02-chip">{projs.size} project(s)</span>
            </div>
            <div className="d02-body d02-scroll">
              <table className="d02-table"><thead><tr><th>Tag</th><th>Model</th><th>On project</th><th>Status</th></tr></thead><tbody>
                {held.length ? held.map((h) => (
                  <tr key={h.id}><td><b>{h.tag}</b></td><td>{h.modelName}</td><td>{h.currentProjectName ?? "—"}</td><td><span className={`d02-chip d02-chip-${h.status === "assigned" ? "assigned" : h.status === "available" ? "ok" : h.status === "lost" ? "lost" : h.status === "in_maintenance" ? "maintenance" : "reserved"}`}>{h.status.replace("_", " ")}</span></td></tr>
                )) : <tr><td colSpan={4}><div className="d02-empty"><CheckCircle2 size={36} /><div>No tools held</div></div></td></tr>}
              </tbody></table>
            </div>
          </div>
        );
      })}
      {!visible.length && (
        <div className="d02-empty" style={{ padding: 60 }}>
          <Users size={48} />
          <div>No foremen to show</div>
        </div>
      )}
      <EmployeeForm open={showForm} onClose={() => setShowForm(false)} />
    </>
  );
}
