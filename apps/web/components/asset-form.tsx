"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      await utils.client.asset.create.mutate({
        tag, modelName, categoryName: categoryName || undefined,
        serialNumber: serialNumber || undefined, quantity,
        acquisitionCost: acquisitionCost || undefined,
        acquisitionDate: acquisitionDate || undefined,
        owningProjectId: owningProjectId || undefined, condition,
        locationId: locationId || undefined,
      });
      setResult("Created!");
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
      setTimeout(onClose, 1200);
    } catch {
      setResult("Error");
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Asset</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Tag *</label>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. UIC-2001" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Model name *</label>
            <Input value={modelName} onChange={(e) => setModelName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Category</label>
            <Input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Serial number</label>
              <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Quantity</label>
              <Input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} min={1} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Acquisition cost</label>
              <Input value={acquisitionCost} onChange={(e) => setAcquisitionCost(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Acquisition date</label>
              <Input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Owning project</label>
            <select value={owningProjectId} onChange={(e) => setOwningProjectId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">Select...</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Condition</label>
            <select value={condition} onChange={(e) => setCondition(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="new">New</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
              <option value="damaged">Damaged</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Location</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">Select...</option>
              {locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          {result && <p className={`text-sm ${result === "Error" ? "text-destructive" : "text-green-600"}`}>{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !tag || !modelName}>{submitting ? "..." : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
