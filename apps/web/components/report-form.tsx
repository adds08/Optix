"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "./modal";

type Props = { open: boolean; onClose: () => void; assetId: string; assetTag: string };

export function ReportForm({ open, onClose, assetId, assetTag }: Props) {
  const utils = trpc.useUtils();
  const [issueType, setIssueType] = useState<"lost" | "in_maintenance">("in_maintenance");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.asset.setStatus.mutate({ id: assetId, status: issueType, note: note || undefined });
      setResult("Reported!");
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
    <Modal open={open} onClose={onClose} title="Report Issue">
      <p style={{ fontSize: 13, margin: "0 0 8px" }}>Reporting: <b>{assetTag}</b></p>

      <label>Issue type</label>
      <select value={issueType} onChange={(e) => setIssueType(e.target.value as "lost" | "in_maintenance")}>
        <option value="in_maintenance">Needs repair / maintenance</option>
        <option value="lost">Lost / missing</option>
      </select>

      <label>Note</label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe the issue..." />

      {result && <div style={{ marginTop: 10, fontSize: 13, color: result === "Error" ? "var(--bad)" : "var(--ok)" }}>{result}</div>}

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit} disabled={submitting}>{submitting ? "..." : "Report"}</button>
      </div>
    </Modal>
  );
}
