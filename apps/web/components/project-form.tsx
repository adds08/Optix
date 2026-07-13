"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "./modal";

type Props = { open: boolean; onClose: () => void };

export function ProjectForm({ open, onClose }: Props) {
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [externalId, setExternalId] = useState("");
  const [status, setStatus] = useState("active");
  const [costCenter, setCostCenter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    if (!name) return;
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.project.create.mutate({ name, externalId: externalId || undefined, status, costCenter: costCenter || undefined, startDate: startDate || undefined, endDate: endDate || undefined });
      setResult("Created!");
      utils.project.list.invalidate();
      setTimeout(onClose, 1200);
    } catch (e: any) {
      setResult(e.message ?? "Error");
    }
    setSubmitting(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="New Project">
      <label>Name *</label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} />

      <div className="form-row">
        <div>
          <label>External ID</label>
          <input type="text" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="awarded">Awarded</option>
            <option value="active">Active</option>
            <option value="closing">Closing</option>
            <option value="complete">Complete</option>
          </select>
        </div>
      </div>

      <label>Cost center</label>
      <input type="text" value={costCenter} onChange={(e) => setCostCenter(e.target.value)} />

      <div className="form-row">
        <div>
          <label>Start date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label>End date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      {result && <div style={{ marginTop: 10, fontSize: 13, color: result === "Error" ? "var(--bad)" : "var(--ok)" }}>{result}</div>}

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit} disabled={submitting || !name}>{submitting ? "..." : "Create"}</button>
      </div>
    </Modal>
  );
}
