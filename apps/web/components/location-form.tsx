"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      await utils.client.location.create.mutate({
        type, name, warehouseId: warehouseId || undefined,
        projectId: projectId || undefined,
      });
      setResult("Created!");
      utils.location.list.invalidate();
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
          <DialogTitle>New Location</DialogTitle>
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
          {result && <p className={`text-sm ${result === "Error" ? "text-destructive" : "text-green-600"}`}>{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name}>{submitting ? "..." : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
