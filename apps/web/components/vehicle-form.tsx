"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      await utils.client.vehicle.create.mutate({
        vehicleType, unit, plate: plate || undefined,
        makeModel: makeModel || undefined, ownershipType,
        projectId: projectId || undefined,
        foremanEmployeeId: foremanEmployeeId || undefined,
      });
      setResult("Created!");
      utils.vehicle.list.invalidate();
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
          <DialogTitle>New Vehicle</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Unit *</label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. TRU-005 / TRA-004" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value as "truck" | "trailer")} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                <option value="truck">Truck</option>
                <option value="trailer">Trailer</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Plate</label>
              <Input value={plate} onChange={(e) => setPlate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Make / Model</label>
            <Input value={makeModel} onChange={(e) => setMakeModel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Ownership</label>
            <select value={ownershipType} onChange={(e) => setOwnershipType(e.target.value as "company_owned" | "personal_allowance")} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="company_owned">Company owned</option>
              <option value="personal_allowance">Personal allowance</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Project</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">Select...</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Foreman</label>
            <select value={foremanEmployeeId} onChange={(e) => setForemanEmployeeId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">Select...</option>
              {foremanOptions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          {result && <p className={`text-sm ${result === "Error" ? "text-destructive" : "text-green-600"}`}>{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !unit}>{submitting ? "..." : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
