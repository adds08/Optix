"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityField } from "@/components/ui/entity-picker";
import { EQUIPMENT_CLASSES, EQUIPMENT_CLASS_LABELS, type EquipmentClass } from "@stinventory/types";

export type VehicleEditable = {
  id: string;
  unit: string;
  vehicleType: string;
  /* REQUIRED, unlike the optional fields around them, and that is the whole
     point. Both were optional when they were added, so the two call sites that
     build an `edit` object silently omitted them and the form fell back to its
     create-time default: opening "Edit" on a truck filed as `heavy` showed
     "Vehicle", and saving any unrelated field — a plate, a project — wrote that
     default back and blanked the VIN. Typecheck said nothing, because absent is
     a legal value for an optional field. Making them required is what turns
     that class of mistake back into a build error. */
  equipmentClass: string | null;
  vin: string | null;
  code?: string | null;
  description?: string | null;
  plate?: string | null;
  makeModel?: string | null;
  ownershipType?: string | null;
  projectId?: string | null;
  attachedToVehicleId?: string | null;
};

/* Foreman is create-only: handing a truck over is `location.setCustodian`,
   which takes the tools aboard with it. `presetProjectId` is how the Tools by
   Jobsite hub's "Add Truck / Add Trailer" opens the form already pointed at
   the job the card represents. */
type Props = { open: boolean; onClose: () => void; edit?: VehicleEditable; presetProjectId?: string | null };

export function VehicleForm({ open, onClose, edit, presetProjectId }: Props) {
  const utils = trpc.useUtils();
  const projects = trpc.project.list.useQuery();
  const foremen = trpc.employee.list.useQuery();
  const vehicles = trpc.vehicle.list.useQuery();
  /* STI-307 — DOMAIN DATA. A truck is assigned to a foreman because that is
     who drives it to a job; `e.role` is the employee register's field, not the
     caller's. Authority to edit a vehicle is `vehicle.manage`. */
  const foremanOptions = foremen.data?.filter((e) => e.role === "foreman" && e.employmentStatus === "active") ?? [];
  const truckOptions = vehicles.data?.filter((v) => v.vehicleType === "truck") ?? [];

  const [vehicleType, setVehicleType] = useState<"truck" | "trailer">(
    (edit?.vehicleType as "truck" | "trailer") ?? "truck",
  );
  /* How the yard files it. Defaults to matching the structural type rather than
     always to "vehicle": a trailer IS an attachment, and pre-selecting the
     obvious answer beats making somebody restate it on every trailer. */
  const [equipmentClass, setEquipmentClass] = useState<EquipmentClass>(
    (edit?.equipmentClass as EquipmentClass) ?? (edit?.vehicleType === "trailer" ? "attachment" : "vehicle"),
  );
  const [vin, setVin] = useState(edit?.vin ?? "");
  const [unit, setUnit] = useState(edit?.unit ?? "");
  const [code, setCode] = useState(edit?.code ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [plate, setPlate] = useState(edit?.plate ?? "");
  const [makeModel, setMakeModel] = useState(edit?.makeModel ?? "");
  const [ownershipType, setOwnershipType] = useState<"company_owned" | "personal_allowance">(
    (edit?.ownershipType as "company_owned" | "personal_allowance") ?? "company_owned",
  );
  const [projectId, setProjectId] = useState(edit?.projectId ?? presetProjectId ?? "");
  const [attachedToVehicleId, setAttachedToVehicleId] = useState(edit?.attachedToVehicleId ?? "");
  const [foremanEmployeeId, setForemanEmployeeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    if (!unit) return;
    setSubmitting(true);
    setResult("");
    try {
      if (edit) {
        await utils.client.vehicle.update.mutate({
          id: edit.id, vehicleType, equipmentClass, vin: vin || null, unit,
          code: code || null,
          description: description || null,
          plate: plate || null,
          makeModel: makeModel || null,
          ownershipType,
          projectId: projectId || null,
          attachedToVehicleId: vehicleType === "trailer" ? (attachedToVehicleId || null) : undefined,
        });
      } else {
        await utils.client.vehicle.create.mutate({
          vehicleType, equipmentClass, vin: vin || undefined, unit,
          code: code || undefined,
          description: description || undefined,
          plate: plate || undefined,
          makeModel: makeModel || undefined, ownershipType,
          projectId: projectId || undefined,
          foremanEmployeeId: foremanEmployeeId || undefined,
          attachedToVehicleId: vehicleType === "trailer" ? (attachedToVehicleId || undefined) : undefined,
        });
      }
      utils.vehicle.list.invalidate();
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
          <DialogTitle>{edit ? `Edit ${edit.unit}` : "New Vehicle"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Unit *</label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. TRU-005 / TRA-004" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Code</label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Equipment register code" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Equipment type</label>
              <EntityField
                value={equipmentClass}
                onChange={(v) => setEquipmentClass(v as EquipmentClass)}
                placeholder="How is it filed?"
                options={EQUIPMENT_CLASSES.map((c) => ({ value: c, label: EQUIPMENT_CLASS_LABELS[c] }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">VIN</label>
              <Input value={vin} onChange={(e) => setVin(e.target.value)} placeholder="Chassis number" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <EntityField
                value={vehicleType}
                onChange={(v) => {
                  const next = v as "truck" | "trailer";
                  setVehicleType(next);
                  /* Follow the type only while creating, and only if the class
                     is still the one we picked for them — never overwrite a
                     filing somebody chose, and never re-file an existing row
                     behind their back. */
                  if (!edit && (equipmentClass === "vehicle" || equipmentClass === "attachment")) {
                    setEquipmentClass(next === "trailer" ? "attachment" : "vehicle");
                  }
                }}
                placeholder="Truck or trailer"
                options={[
                  { value: "truck", label: "Truck" },
                  { value: "trailer", label: "Trailer" },
                ]}
              />
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
            <EntityField
              value={ownershipType}
              onChange={(v) => setOwnershipType(v as "company_owned" | "personal_allowance")}
              placeholder="How it is owned"
              options={[
                { value: "company_owned", label: "Company owned" },
                { value: "personal_allowance", label: "Personal allowance" },
              ]}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Project</label>
            <EntityField
              value={projectId}
              onChange={setProjectId}
              placeholder="Select..."
              searchPlaceholder="Project name or code"
              emptyLabel="No job matches."
              options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.externalId ?? undefined }))}
            />
          </div>
          {/* Create-only. Changing who has a truck is Hand over on Locations,
              which moves the tools aboard with it. */}
          <div className={edit ? "hidden" : "space-y-2"}>
            <label className="text-sm font-medium">Foreman</label>
            <EntityField
              value={foremanEmployeeId}
              onChange={setForemanEmployeeId}
              placeholder="Select..."
              searchPlaceholder="Name or employee number"
              emptyLabel="Nobody matches."
              options={foremanOptions.map((f) => ({ value: f.id, label: f.name, hint: f.externalId ?? undefined }))}
            />
          </div>
          {/* Trailers only. This is how a superintendent tells the system which
              truck a trailer is hitched to — the trailer then rides with that
              truck's foreman, tools included. */}
          {vehicleType === "trailer" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Attached to truck</label>
              <EntityField
                value={attachedToVehicleId}
                onChange={setAttachedToVehicleId}
                placeholder="Not hitched to a truck"
                searchPlaceholder="Unit number"
                emptyLabel="No truck matches."
                options={truckOptions.map((t) => ({ value: t.id, label: t.unit, hint: t.foremanName ?? undefined }))}
              />
              <p className="text-xs text-muted-foreground">
                The trailer and its tools follow the truck — hand the truck to a foreman and the trailer goes with it.
              </p>
            </div>
          ) : null}
          {result && <p className="text-sm text-destructive">{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !unit}>{submitting ? "..." : edit ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
