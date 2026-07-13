"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "./modal";

type Props = { open: boolean; onClose: () => void };

export function EmployeeForm({ open, onClose }: Props) {
  const utils = trpc.useUtils();
  const projects = trpc.project.list.useQuery();
  const allEmployees = trpc.employee.list.useQuery();
  const superintendents = allEmployees.data?.filter((e) => e.role === "superintendent") ?? [];

  const [name, setName] = useState("");
  const [externalId, setExternalId] = useState("");
  const [role, setRole] = useState("foreman");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [primaryProjectId, setPrimaryProjectId] = useState("");
  const [reportsToEmployeeId, setReportsToEmployeeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    if (!name) return;
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.employee.create.mutate({ name, externalId: externalId || undefined, role, email: email || undefined, phone: phone || undefined, primaryProjectId: primaryProjectId || undefined, reportsToEmployeeId: reportsToEmployeeId || undefined });
      setResult("Created!");
      utils.employee.list.invalidate();
      setTimeout(onClose, 1200);
    } catch (e: any) {
      setResult(e.message ?? "Error");
    }
    setSubmitting(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="New Employee">
      <label>Name *</label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} />

      <div className="form-row">
        <div>
          <label>External ID</label>
          <input type="text" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
        </div>
        <div>
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="foreman">Foreman</option>
            <option value="superintendent">Superintendent</option>
            <option value="equipment_admin">Equipment Admin</option>
            <option value="warehouse">Warehouse</option>
          </select>
        </div>
      </div>

      <div className="form-row">
        <div>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label>Phone</label>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>

      <label>Primary project</label>
      <select value={primaryProjectId} onChange={(e) => setPrimaryProjectId(e.target.value)}>
        <option value="">Select...</option>
        {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      {role === "foreman" && (
        <>
          <label>Reports to (superintendent)</label>
          <select value={reportsToEmployeeId} onChange={(e) => setReportsToEmployeeId(e.target.value)}>
            <option value="">None</option>
            {superintendents.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </>
      )}

      {result && <div style={{ marginTop: 10, fontSize: 13, color: result === "Error" ? "var(--bad)" : "var(--ok)" }}>{result}</div>}

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit} disabled={submitting || !name}>{submitting ? "..." : "Create"}</button>
      </div>
    </Modal>
  );
}
