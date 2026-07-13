"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Can } from "@/components/can";
import { EmployeeForm } from "@/components/employee-form";

function statusChip(s: string) {
  return <span className={`chip ${s}`}>{s.replace("_", " ")}</span>;
}
const money = (n: string | null | undefined) => "$" + Number(n ?? 0).toLocaleString();

export default function ForemenPage() {
  const employees = trpc.employee.list.useQuery();
  const me = trpc.identity.me.useQuery();
  const myEmployeeId = me.data?.employeeId ?? null;
  const isSuper = me.data?.role === "superintendent";
  const foremen = employees.data?.filter((e) => e.role === "foreman") ?? [];
  const assets = trpc.asset.list.useQuery();
  const [showForm, setShowForm] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);

  const isMyForeman = (f: { reportsToEmployeeId: string | null }) =>
    isSuper && !!myEmployeeId && f.reportsToEmployeeId === myEmployeeId;

  const visible = onlyMine && isSuper ? foremen.filter(isMyForeman) : foremen;

  return (
    <>
      <div className="toolbar" style={{ gap: 8, padding: "8px 14px", display: "flex" }}>
        <Can perm="employee.manage">
          <button className="btn btn-sm" onClick={() => setShowForm(true)}>+ New Employee</button>
        </Can>
        {isSuper && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
            My Foremen only
          </label>
        )}
      </div>
      {visible.map((f) => {
        const held = assets.data?.filter((a) => a.custodianId === f.id && a.status !== "available") ?? [];
        const val = held.reduce((s, x) => s + Number(x.acquisitionCost ?? 0), 0);
        const projs = new Set(held.map((h) => h.currentProjectName).filter(Boolean));
        const mine = isMyForeman(f);
        return (
          <div className="card" key={f.id} style={mine ? { borderLeft: "4px solid var(--ok)" } : undefined}>
            <h2>{f.name} {f.employmentStatus === "terminated" ? <span className="chip lost">terminated</span> : null}
              {f.reportsToName ? <span className="chip" style={{ marginLeft: 8 }}>Reports to {f.reportsToName}</span> : null}
              {mine ? <span className="chip" style={{ marginLeft: 8, background: "var(--ok)", color: "#fff" }}>★ My foreman</span> : null}
            </h2>
            <div className="toolbar">
              <span className="chip">Primary: {f.primaryProjectName ?? "—"}</span>
              <span className="chip">{held.length} tools</span>
              <span className="chip">{money(val.toString())}</span>
              <span className="chip">{projs.size} project(s)</span>
            </div>
            <div className="body scroll"><table><thead><tr><th>Tag</th><th>Model</th><th>On project</th><th>Status</th></tr></thead><tbody>
              {held.length ? held.map((h) => (
                <tr key={h.id}><td>{h.tag}</td><td>{h.modelName}</td><td>{h.currentProjectName ?? "—"}</td><td>{statusChip(h.status)}</td></tr>
              )) : <tr><td colSpan={4} className="muted" style={{ padding: 12 }}>No tools held</td></tr>}
            </tbody></table></div>
          </div>
        );
      })}
      <EmployeeForm open={showForm} onClose={() => setShowForm(false)} />
    </>
  );
}
