"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "./modal";

type Props = { open: boolean; onClose: () => void };

export function LocationForm({ open, onClose }: Props) {
  const utils = trpc.useUtils();
  const warehouses = trpc.location.list.useQuery();
  const projects = trpc.project.list.useQuery();

  const [type, setType] = useState("site_container");
  const [name, setName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const whOptions = warehouses.data?.filter((l) => l.type === "warehouse" && l.warehouseId) ?? [];

  const submit = async () => {
    if (!name) return;
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.location.create.mutate({ type, name, warehouseId: warehouseId || undefined, projectId: projectId || undefined });
      setResult("Created!");
      utils.location.list.invalidate();
      setTimeout(onClose, 1200);
    } catch (e: any) {
      setResult(e.message ?? "Error");
    }
    setSubmitting(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="New Location">
      <label>Name *</label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} />

      <label>Type</label>
      <select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="warehouse">Warehouse</option>
        <option value="site_container">Site container</option>
        <option value="gang_box">Gang box</option>
        <option value="project_site">Project site</option>
      </select>

      <label>Warehouse (parent)</label>
      <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
        <option value="">None</option>
        {whOptions.map((w) => <option key={w.warehouseId!} value={w.warehouseId!}>{w.name}</option>)}
      </select>

      <label>Project</label>
      <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">None</option>
        {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      {result && <div style={{ marginTop: 10, fontSize: 13, color: result === "Error" ? "var(--bad)" : "var(--ok)" }}>{result}</div>}

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit} disabled={submitting || !name}>{submitting ? "..." : "Create"}</button>
      </div>
    </Modal>
  );
}
