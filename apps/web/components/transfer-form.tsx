"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "./modal";
import { usePermissions } from "./use-permissions";

type Props = { open: boolean; onClose: () => void; assetId: string; assetTag: string };

export function TransferForm({ open, onClose, assetId, assetTag }: Props) {
  const { role } = usePermissions();
  const utils = trpc.useUtils();
  const myForemen = trpc.employee.myForemen.useQuery(undefined, { enabled: role === "superintendent" });
  const foremen = trpc.employee.list.useQuery();
  const projects = trpc.project.list.useQuery();
  const locations = trpc.location.list.useQuery();

  let custodianOptions = foremen.data?.filter((e) => e.role === "foreman" && e.employmentStatus === "active") ?? [];
  if (role === "superintendent") {
    const ids = new Set(myForemen.data?.map((f) => f.id) ?? []);
    custodianOptions = custodianOptions.filter((e) => ids.has(e.id));
  }

  const [toCustodianId, setToCustodianId] = useState("");
  const [toProjectId, setToProjectId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [reason, setReason] = useState("reallocation");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    if (!toCustodianId) return;
    setSubmitting(true);
    setResult("");
    try {
      const res = await utils.client.transfer.create.mutate({ assetId, toCustodianId, toProjectId: toProjectId || undefined, toLocationId: toLocationId || undefined, reason });
      setResult(res.needsApproval ? "Pending approval" : "Transferred!");
      utils.transfer.list.invalidate();
      utils.assignment.list.invalidate();
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
      utils.dashboard.recentActivity.invalidate();
      setTimeout(onClose, 1200);
    } catch (e: any) {
      setResult(e.message ?? "Error");
    }
    setSubmitting(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="Transfer Tool">
      <p style={{ fontSize: 13, margin: "0 0 8px" }}>Transferring: <b>{assetTag}</b></p>

      <label>To custodian</label>
      <select value={toCustodianId} onChange={(e) => setToCustodianId(e.target.value)}>
        <option value="">Select custodian...</option>
        {custodianOptions.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>

      <label>To project</label>
      <select value={toProjectId} onChange={(e) => setToProjectId(e.target.value)}>
        <option value="">No change</option>
        {projects.data?.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      <label>To location</label>
      <select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
        <option value="">No change</option>
        {locations.data?.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>

      <label>Reason</label>
      <select value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="reallocation">Reallocation</option>
        <option value="project_complete">Project complete</option>
        <option value="phase_change">Phase change</option>
        <option value="hr_offboarding">HR offboarding</option>
        <option value="repair">Repair</option>
        <option value="handoff">Handoff</option>
      </select>

      {result && <div style={{ marginTop: 10, fontSize: 13, color: result === "Error" ? "var(--bad)" : "var(--ok)" }}>{result}</div>}

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit} disabled={submitting || !toCustodianId}>{submitting ? "..." : "Transfer"}</button>
      </div>
    </Modal>
  );
}
