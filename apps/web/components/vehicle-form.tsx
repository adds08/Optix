"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "./modal";

type Props = { open: boolean; onClose: () => void };

export function VehicleForm({ open, onClose }: Props) {
  const utils = trpc.useUtils();
  const projects = trpc.project.list.useQuery();
  const foremen = trpc.employee.list.useQuery();
  const foremanOptions = foremen.data?.filter((e) => e.role === "foreman" && e.employmentStatus === "active") ?? [];

  const [vehicleType, setVehicleType] = useState<"truck" | "trailer">("truck");
  const [unit, setUnit] = useState("");
  const [plate, setPlate] = useState("");
  const [makeModel, setMakeModel] = useState("");
  const [ownershipType, setOwnershipType] = useState<"company_owned" | "personal_allowance">("company_owned");
  const [projectId, setProjectId] = useState("");
  const [foremanEmployeeId, setForemanEmployeeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    if (!unit) return;
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.vehicle.create.mutate({ vehicleType, unit, plate: plate || undefined, makeModel: makeModel || undefined, ownershipType, projectId: projectId || undefined, foremanEmployeeId: foremanEmployeeId || undefined });
      setResult("Created!");
      utils.vehicle.list.invalidate();
      setTimeout(onClose, 1200);
    } catch (e: any) {
      setResult(e.message ?? "Error");
    }
    setSubmitting(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="New Vehicle">
      <label>Unit *</label>
      <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. TRU-005 / TRA-004" />

      <div className="form-row">
        <div>
          <label>Type</label>
          <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value as "truck" | "trailer")}>
            <option value="truck">Truck</option>
            <option value="trailer">Trailer</option>
          </select>
        </div>
        <div>
          <label>Plate</label>
          <input type="text" value={plate} onChange={(e) => setPlate(e.target.value)} />
        </div>
      </div>

      <label>Make / Model</label>
      <input type="text" value={makeModel} onChange={(e) => setMakeModel(e.target.value)} />

      <label>Ownership</label>
      <select value={ownershipType} onChange={(e) => setOwnershipType(e.target.value as "company_owned" | "personal_allowance")}>
        <option value="company_owned">Company owned</option>
        <option value="personal_allowance">Personal allowance</option>
      </select>

      <label>Project</label>
      <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">Select...</option>
        {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <label>Foreman</label>
      <select value={foremanEmployeeId} onChange={(e) => setForemanEmployeeId(e.target.value)}>
        <option value="">Select...</option>
        {foremanOptions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>

      {result && <div style={{ marginTop: 10, fontSize: 13, color: result === "Error" ? "var(--bad)" : "var(--ok)" }}>{result}</div>}

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit} disabled={submitting || !unit}>{submitting ? "..." : "Create"}</button>
      </div>
    </Modal>
  );
}
