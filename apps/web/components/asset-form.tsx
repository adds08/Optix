"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  modelName: string;
  categoryName?: string | null;
  serialNumber?: string | null;
  quantity?: number | null;
  acquisitionCost?: string | null;
  acquisitionDate?: string | null;
  condition?: string | null;
  owningProjectId?: string | null;
};

type Props = { open: boolean; onClose: () => void; edit?: AssetEditable };

export function AssetForm({ open, onClose, edit }: Props) {
  const utils = trpc.useUtils();
  const projects = trpc.project.list.useQuery();
  const locations = trpc.location.list.useQuery();

  const [tag, setTag] = useState(edit?.tag ?? "");
  const [modelName, setModelName] = useState(edit?.modelName ?? "");
  const [categoryName, setCategoryName] = useState(edit?.categoryName ?? "");
  const [serialNumber, setSerialNumber] = useState(edit?.serialNumber ?? "");
  const [quantity, setQuantity] = useState(edit?.quantity ?? 1);
  const [acquisitionCost, setAcquisitionCost] = useState(edit?.acquisitionCost ?? "");
  const [acquisitionDate, setAcquisitionDate] = useState(edit?.acquisitionDate ?? "");
  const [owningProjectId, setOwningProjectId] = useState(edit?.owningProjectId ?? "");
  const [condition, setCondition] = useState(edit?.condition ?? "good");
  const [locationId, setLocationId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    if (!tag || !modelName) return;
    setSubmitting(true);
    setResult("");
    try {
      if (edit) {
        /* Nulls rather than undefined: clearing a serial has to persist as
           empty, and `undefined` would leave the old value in place. */
        await utils.client.asset.update.mutate({
          id: edit.id,
          tag, modelName,
          categoryName: categoryName || null,
          serialNumber: serialNumber || null,
          quantity,
          acquisitionCost: acquisitionCost || null,
          acquisitionDate: acquisitionDate || null,
          owningProjectId: owningProjectId || null,
          condition,
        });
        utils.asset.get.invalidate({ id: edit.id });
      } else {
        await utils.client.asset.create.mutate({
          tag, modelName, categoryName: categoryName || undefined,
          serialNumber: serialNumber || undefined, quantity,
          acquisitionCost: acquisitionCost || undefined,
          acquisitionDate: acquisitionDate || undefined,
          owningProjectId: owningProjectId || undefined, condition,
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
          <Button onClick={submit} disabled={submitting || !tag || !modelName}>{submitting ? "..." : edit ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
