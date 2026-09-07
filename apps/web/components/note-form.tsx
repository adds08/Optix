"use client";
import { useState } from "react";
import { StickyNote } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = { open: boolean; onClose: () => void; assetId: string; assetCode: string };

/*
  A real annotation, distinct from "Report an issue".

  `action.submit` type `report` writes a ledger event that changes NOTHING about
  the tool — no status, no custody — and is applyable by any signed-in member
  (permission null in the intent catalog). That event is what makes the note
  appear in the tool's "Custody chain" trail instead of evaporating.

  The old "Add a note" menu item opened ReportForm, which always moved the tool
  to `in_maintenance` or `lost`; that is why the two felt identical. This form
  is the note; ReportForm stays the report.
*/
export function NoteForm({ open, onClose, assetId, assetCode }: Props) {
  const utils = trpc.useUtils();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const submit = trpc.action.submit.useMutation();

  const send = async () => {
    const text = note.trim();
    if (!text) {
      setError("Write the note first — an empty note adds nothing to the record.");
      return;
    }
    setError("");
    try {
      await submit.mutateAsync({ type: "report", assetIds: [assetId], note: text });
      utils.asset.get.invalidate({ id: assetId });
      utils.transaction.list.invalidate({ assetId });
      utils.asset.list.invalidate();
      setNote("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the note. Try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a note to {assetCode}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            An observation that changes nothing about where the tool is — it is appended to the
            tool&apos;s audit trail so the next person who opens it sees it.
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. the saw blade is nearly worn out, still fine for now"
            className="flex min-h-[96px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground resize-y"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={submit.isPending}>
            {submit.isPending ? (
              <span className="flex items-center gap-1.5">
                <StickyNote className="size-4" /> Saving…
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <StickyNote className="size-4" /> Add note
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
