"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityField } from "@/components/ui/entity-picker";

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
            <EntityField
              value={type}
              onChange={setType}
              placeholder="What kind of place"
              options={[
                { value: "warehouse", label: "Warehouse" },
                { value: "site_container", label: "Site container" },
                { value: "gang_box", label: "Gang box" },
                { value: "project_site", label: "Project site" },
              ]}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Warehouse (parent)</label>
            <EntityField
              value={warehouseId}
              onChange={setWarehouseId}
              placeholder="None"
              searchPlaceholder="Search warehouses…"
              emptyLabel="No warehouse matches."
              options={whOptions.map((w) => ({ value: w.warehouseId!, label: w.name }))}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Project</label>
            <EntityField
              value={projectId}
              onChange={setProjectId}
              placeholder="None"
              searchPlaceholder="Project name or code"
              emptyLabel="No job matches."
              options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.externalId ?? undefined }))}
            />
          </div>
          {/* A container someone carries; a yard nobody does. Leaving this blank
              is the right answer for warehouses and project sites. */}
          <div className={edit ? "hidden" : "space-y-2"}>
            <label className="text-sm font-medium">Held by</label>
            <EntityField
              value={custodianEmployeeId}
              onChange={setCustodianEmployeeId}
              placeholder="Nobody carries it"
              searchPlaceholder="Name or employee number"
              emptyLabel="Nobody matches."
              options={(employees.data ?? []).map((e) => ({ value: e.id, label: e.name, hint: e.externalId ?? undefined }))}
            />
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
