"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type LocationEditable = {
  id: string;
  name: string;
  type: string;
  warehouseId?: string | null;
  projectId?: string | null;
};

/* "Held by" is create-only: handing a container over is `setCustodian`, which
   also moves the tools inside it. Setting the column alone would say a trailer
   belongs to somebody while its contents sit with the last person. */
type Props = { open: boolean; onClose: () => void; edit?: LocationEditable };

export function LocationForm({ open, onClose, edit }: Props) {
  const utils = trpc.useUtils();
  const warehouses = trpc.location.list.useQuery();
  const projects = trpc.project.list.useQuery();
  const employees = trpc.employee.list.useQuery();

  const [type, setType] = useState(edit?.type ?? "site_container");
  const [name, setName] = useState(edit?.name ?? "");
  const [warehouseId, setWarehouseId] = useState(edit?.warehouseId ?? "");
  const [projectId, setProjectId] = useState(edit?.projectId ?? "");
  const [custodianEmployeeId, setCustodianEmployeeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const whOptions = warehouses.data?.filter((l) => l.type === "warehouse" && l.warehouseId) ?? [];

  const submit = async () => {
    if (!name) return;
    setSubmitting(true);
    setResult("");
    try {
      if (edit) {
        await utils.client.location.update.mutate({
          id: edit.id, name, type,
          warehouseId: warehouseId || null,
          projectId: projectId || null,
        });
      } else {
        await utils.client.location.create.mutate({
          type, name, warehouseId: warehouseId || undefined,
          projectId: projectId || undefined,
          custodianEmployeeId: custodianEmployeeId || undefined,
        });
      }
      utils.location.list.invalidate();
      onClose();
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Could not save. Try again.");
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{edit ? `Edit ${edit.name}` : "New Location"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="warehouse">Warehouse</option>
              <option value="site_container">Site container</option>
              <option value="gang_box">Gang box</option>
              <option value="project_site">Project site</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Warehouse (parent)</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">None</option>
              {whOptions.map((w) => <option key={w.warehouseId!} value={w.warehouseId!}>{w.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Project</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">None</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {/* A container someone carries; a yard nobody does. Leaving this blank
              is the right answer for warehouses and project sites. */}
          <div className={edit ? "hidden" : "space-y-2"}>
            <label className="text-sm font-medium">Held by</label>
            <select value={custodianEmployeeId} onChange={(e) => setCustodianEmployeeId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">Nobody carries it</option>
              {employees.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          {result && <p className="text-sm text-destructive">{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name}>{submitting ? "..." : edit ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
