"use client";
import { useState } from "react";
import { Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = { open: boolean; onClose: () => void; assetId: string; assetCode: string; current?: string | null };

const CONDITIONS = [
  { value: "new", label: "New" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
  { value: "damaged", label: "Damaged" },
] as const;

/*
  Change a tool's physical CONDITION (new / good / fair / poor / damaged).

  Status is where the tool is in the workflow; condition is how worn it is.
  The register only let you change condition through "Edit details", which is
  why it read as uneditable. This writes the condition via `asset.update` and
  appends a note-only ledger event ("Condition → fair") so the change shows up
  in the tool's Custody chain like every other event.
*/
export function ConditionForm({ open, onClose, assetId, assetCode, current }: Props) {
  const utils = trpc.useUtils();
  const [condition, setCondition] = useState<string>(current ?? "good");
  const [error, setError] = useState("");
  const update = trpc.asset.update.useMutation();
  const note = trpc.action.submit.useMutation();

  const save = async () => {
    setError("");
    try {
      await update.mutateAsync({ id: assetId, condition });
      /* Best-effort trail entry — the condition edit itself writes only the
         audit log, so this note is what makes it visible in the custody chain. */
      try {
        await note.mutateAsync({ type: "report", assetIds: [assetId], note: `Condition → ${condition}` });
      } catch {
        /* Update already applied; the note is not worth failing the save over. */
      }
      utils.asset.get.invalidate({ id: assetId });
      utils.transaction.list.invalidate({ assetId });
      utils.asset.list.invalidate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the condition. Try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Condition of {assetCode}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            How worn the tool is. Current: <span className="font-medium text-foreground">{current ?? "good"}</span>
          </p>
          <div className="grid grid-cols-1 gap-1.5">
            {CONDITIONS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCondition(c.value)}
                aria-pressed={condition === c.value}
                className={cn(
                  "flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-accent",
                  condition === c.value && "border-primary ring-2 ring-ring/40",
                )}
              >
                <Wrench className={cn("size-4", condition === c.value ? "text-primary" : "text-muted-foreground")} />
                <span className="font-medium">{c.label}</span>
              </button>
            ))}
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save condition"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
