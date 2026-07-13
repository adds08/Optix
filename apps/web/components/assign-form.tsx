"use client";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "./modal";
import { usePermissions } from "./use-permissions";

type Props = { open: boolean; onClose: () => void; preselectedAssetId?: string };

export function AssignForm({ open, onClose, preselectedAssetId }: Props) {
  const { role, has } = usePermissions();
  const utils = trpc.useUtils();
  const assets = trpc.asset.list.useQuery({ status: "available" });
  const projects = trpc.project.list.useQuery();
  const foremen = trpc.employee.list.useQuery();
  const myForemen = trpc.employee.myForemen.useQuery(undefined, { enabled: role === "superintendent" });
  const me = trpc.identity.me.useQuery();

  const isSuper = role === "superintendent";
  const isWarehouseOrAdmin = has("employee.manage");

  // Determine custodian options
  let custodianOptions = foremen.data?.filter((e) => e.role === "foreman" && e.employmentStatus === "active") ?? [];
  if (isSuper) {
    const myForemanIds = new Set(myForemen.data?.map((f) => f.id) ?? []);
    custodianOptions = custodianOptions.filter((e) => myForemanIds.has(e.id));
  } else if (!isWarehouseOrAdmin) {
    // Foreman can only assign to themselves
    custodianOptions = custodianOptions.filter((e) => e.id === me.data?.employeeId);
  }

  const [assetId, setAssetId] = useState(preselectedAssetId ?? "");
  const [custodianId, setCustodianId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [type, setType] = useState<"permanent" | "temporary">("permanent");
  const [expectedEnd, setExpectedEnd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  useEffect(() => { setAssetId(preselectedAssetId ?? ""); }, [preselectedAssetId]);

  const submit = async () => {
    if (!assetId || !custodianId) return;
    setSubmitting(true);
    setResult("");
    try {
      const res = await utils.client.assignment.create.mutate({ assetId, custodianId, projectId: projectId || undefined, type, expectedEnd: expectedEnd || undefined });
      setResult(res.needsApproval ? "Pending approval" : "Assigned!");
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
    <Modal open={open} onClose={onClose} title="Assign Tool">
      <label>Asset</label>
      <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
        <option value="">Select asset...</option>
        {assets.data?.map((a) => (
          <option key={a.id} value={a.id}>{a.tag} — {a.modelName}</option>
        ))}
      </select>

      <label>Custodian</label>
      <select value={custodianId} onChange={(e) => setCustodianId(e.target.value)}>
        <option value="">Select custodian...</option>
        {custodianOptions.map((e) => (
          <option key={e.id} value={e.id}>{e.name} {e.externalId ? `#${e.externalId}` : ""}</option>
        ))}
      </select>

      <label>Project</label>
      <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">Default (custodian's primary)</option>
        {projects.data?.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      <label>Type</label>
      <select value={type} onChange={(e) => setType(e.target.value as "permanent" | "temporary")}>
        <option value="permanent">Permanent</option>
        <option value="temporary">Temporary (loan)</option>
      </select>

      {type === "temporary" && (
        <>
          <label>Expected end date</label>
          <input type="date" value={expectedEnd} onChange={(e) => setExpectedEnd(e.target.value)} />
        </>
      )}

      {result && <div style={{ marginTop: 10, fontSize: 13, color: result === "Error" ? "var(--bad)" : "var(--ok)" }}>{result}</div>}

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit} disabled={submitting || !assetId || !custodianId}>{submitting ? "..." : "Assign"}</button>
      </div>
    </Modal>
  );
}
