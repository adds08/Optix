"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "./modal";

type Props = { open: boolean; onClose: () => void };

export function AssetForm({ open, onClose }: Props) {
  const utils = trpc.useUtils();
  const projects = trpc.project.list.useQuery();
  const locations = trpc.location.list.useQuery();

  const [tag, setTag] = useState("");
  const [modelName, setModelName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [acquisitionCost, setAcquisitionCost] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState("");
  const [owningProjectId, setOwningProjectId] = useState("");
  const [condition, setCondition] = useState("good");
  const [locationId, setLocationId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    if (!tag || !modelName) return;
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.asset.create.mutate({ tag, modelName, categoryName: categoryName || undefined, serialNumber: serialNumber || undefined, quantity, acquisitionCost: acquisitionCost || undefined, acquisitionDate: acquisitionDate || undefined, owningProjectId: owningProjectId || undefined, condition, locationId: locationId || undefined });
      setResult("Created!");
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
      setTimeout(onClose, 1200);
    } catch (e: any) {
      setResult(e.message ?? "Error");
    }
    setSubmitting(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="New Asset">
      <label>Tag *</label>
      <input type="text" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. UIC-2001" />

      <label>Model name *</label>
      <input type="text" value={modelName} onChange={(e) => setModelName(e.target.value)} />

      <label>Category</label>
      <input type="text" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />

      <div className="form-row">
        <div>
          <label>Serial number</label>
          <input type="text" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
        </div>
        <div>
          <label>Quantity</label>
          <input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} min={1} />
        </div>
      </div>

      <div className="form-row">
        <div>
          <label>Acquisition cost</label>
          <input type="text" value={acquisitionCost} onChange={(e) => setAcquisitionCost(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <label>Acquisition date</label>
          <input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
        </div>
      </div>

      <label>Owning project</label>
      <select value={owningProjectId} onChange={(e) => setOwningProjectId(e.target.value)}>
        <option value="">Select...</option>
        {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <label>Condition</label>
      <select value={condition} onChange={(e) => setCondition(e.target.value)}>
        <option value="new">New</option>
        <option value="good">Good</option>
        <option value="fair">Fair</option>
        <option value="poor">Poor</option>
        <option value="damaged">Damaged</option>
      </select>

      <label>Location</label>
      <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
        <option value="">Select...</option>
        {locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>

      {result && <div style={{ marginTop: 10, fontSize: 13, color: result === "Error" ? "var(--bad)" : "var(--ok)" }}>{result}</div>}

      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit} disabled={submitting || !tag || !modelName}>{submitting ? "..." : "Create"}</button>
      </div>
    </Modal>
  );
}
