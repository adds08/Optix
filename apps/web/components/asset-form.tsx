"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategorySelect } from "@/components/category-select";
import { PhotoUpload } from "@/components/photo-upload";
import { cn } from "@/lib/utils";

/*
  One dialog for both jobs.

  Passing `edit` turns it into an edit form: the fields start populated and it
  calls `asset.update` instead of `asset.create`. Keeping the two in one
  component is what stops the edit dialog quietly losing a field the create
  dialog gained.

  Location is create-only on purpose. Where a tool IS comes from the
  transaction log — moving it is Assign, Transfer or Return, not a text field.
*/
export type AssetEditable = {
  id: string;
  tag: string;
  make?: string | null;
  modelNumber?: string | null;
  description?: string | null;
  categoryName?: string | null;
  photoKey?: string | null;
  serialNumber?: string | null;
  isManualCode?: boolean | null;
  quantity?: number | null;
  acquisitionCost?: string | null;
  acquisitionDate?: string | null;
  condition?: string | null;
  owningProjectId?: string | null;
  costTarget?: "project" | "department";
  owningDepartmentId?: string | null;
};

type Props = { open: boolean; onClose: () => void; edit?: AssetEditable };

export function AssetForm({ open, onClose, edit }: Props) {
  const utils = trpc.useUtils();
  const projects = trpc.project.list.useQuery();
  const departments = trpc.department.list.useQuery();
  const locations = trpc.location.list.useQuery();

  const [tag, setTag] = useState(edit?.tag ?? "");
  const [make, setMake] = useState(edit?.make ?? "");
  const [modelNumber, setModelNumber] = useState(edit?.modelNumber ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [categoryName, setCategoryName] = useState(edit?.categoryName ?? "");
  const [photoKey, setPhotoKey] = useState<string | null>(edit?.photoKey ?? null);
  const [serialNumber, setSerialNumber] = useState(edit?.serialNumber ?? "");
  const [isManualCode, setIsManualCode] = useState(edit?.isManualCode ?? false);
  const [quantity, setQuantity] = useState(edit?.quantity ?? 1);
  const [acquisitionCost, setAcquisitionCost] = useState(edit?.acquisitionCost ?? "");
  const [acquisitionDate, setAcquisitionDate] = useState(edit?.acquisitionDate ?? "");
  const [costTarget, setCostTarget] = useState<"project" | "department">(
    edit?.costTarget ?? "project",
  );
  const [owningProjectId, setOwningProjectId] = useState(edit?.owningProjectId ?? "");
  const [owningDepartmentId, setOwningDepartmentId] = useState(
    edit?.owningDepartmentId ?? departments.data?.find((d) => d.code === "RM")?.id ?? "",
  );
  const [condition, setCondition] = useState(edit?.condition ?? "good");
  const [locationId, setLocationId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  /* A submitted form never carries both targets — switching the toggle clears
     the other one, and the router's superRefine enforces exactly one either way. */
  const switchTarget = (t: "project" | "department") => {
    setCostTarget(t);
    if (t === "project") setOwningDepartmentId("");
    else setOwningProjectId("");
  };

  const submit = async () => {
    if (!make && !description) return;
    setSubmitting(true);
    setResult("");
    try {
      if (edit) {
        /* Nulls rather than undefined: clearing a serial has to persist as
           empty, and `undefined` would leave the old value in place. */
        await utils.client.asset.update.mutate({
          id: edit.id,
          tag,
          make: make || null,
          modelNumber: modelNumber || null,
          description: description || null,
          categoryName: categoryName || null,
          serialNumber: serialNumber || null,
          isManualCode,
          quantity,
          acquisitionCost: acquisitionCost || null,
          acquisitionDate: acquisitionDate || null,
          owningProjectId: costTarget === "project" ? owningProjectId || null : null,
          costTarget,
          owningDepartmentId: costTarget === "department" ? owningDepartmentId || null : null,
          condition,
        });
        utils.asset.get.invalidate({ id: edit.id });
      } else {
        await utils.client.asset.create.mutate({
          tag: tag || undefined,
          make: make || undefined,
          modelNumber: modelNumber || undefined,
          description: description || undefined,
          categoryName: categoryName || undefined,
          serialNumber: serialNumber || undefined,
          isManualCode,
          quantity,
          acquisitionCost: acquisitionCost || undefined,
          acquisitionDate: acquisitionDate || undefined,
          owningProjectId: costTarget === "project" ? owningProjectId || undefined : undefined,
          costTarget,
          owningDepartmentId: costTarget === "department" ? owningDepartmentId || undefined : undefined,
          condition,
          locationId: locationId || undefined,
        });
      }
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
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
          <DialogTitle>{edit ? `Edit ${edit.tag}` : "New Asset"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Tag</label>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. UIC-2001" />
            <p className="text-xs text-muted-foreground">
              The label physically on the tool. Leave blank until it has one — an untagged tool is a normal state.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Make</label>
            <Input value={make} onChange={(e) => setMake(e.target.value)} placeholder="e.g. Bosch" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Model number</label>
            <Input value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} placeholder="e.g. 11255VSR" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description *</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Rotary Hammer" />
            <p className="text-xs text-muted-foreground">
              What the tool is. A make or a description is required — the model number is always optional.
            </p>
          </div>
          {/* Only when the tool exists — an upload needs somewhere to attach,
              and inventing an id before the row is saved would orphan the file
              if the form is abandoned. */}
          {edit?.id ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Photo</label>
              <PhotoUpload assetId={edit.id} photoKey={photoKey} onChange={setPhotoKey} />
            </div>
          ) : null}
          <div className="space-y-2">
            <label className="text-sm font-medium">Category</label>
            <CategorySelect value={categoryName} onChange={setCategoryName} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Code</label>
              <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={isManualCode}
                  onChange={(e) => setIsManualCode(e.target.checked)}
                  className="size-3.5"
                />
                Entered by hand, not a scanned serial
              </label>
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
            <label className="text-sm font-medium">Charged to</label>
            <div className="grid grid-cols-2 gap-2 rounded-md border p-1" role="group" aria-label="Cost target">
              {(["project", "department"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => switchTarget(t)}
                  aria-pressed={costTarget === t}
                  className={cn(
                    "rounded-sm px-3 py-1.5 text-sm transition-colors",
                    costTarget === t
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {t === "project" ? "Project" : "Department"}
                </button>
              ))}
            </div>
            {costTarget === "project" ? (
              <select value={owningProjectId} onChange={(e) => setOwningProjectId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                <option value="">Select...</option>
                {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : (
              <select value={owningDepartmentId} onChange={(e) => setOwningDepartmentId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                <option value="">Select...</option>
                {departments.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
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
          {/* Only when creating. On an existing tool, where it is comes from
              the ledger — use Assign, Transfer or Return to move it. */}
          {edit ? null : (
            <div className="space-y-2">
              <label className="text-sm font-medium">Location</label>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                <option value="">Select...</option>
                {locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
          {result && <p className="text-sm text-destructive">{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || (!make && !description)}>{submitting ? "..." : edit ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
