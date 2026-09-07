"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EntityField } from "@/components/ui/entity-picker";

type Props = { open: boolean; onClose: () => void; assetId: string; assetCode: string };

/*
  "Report an issue" — a tool is broken (needs repair) or missing.

  Routes through `action.submit` (lost / repair) rather than `asset.setStatus`
  so the SAME permission rules as the chat path apply: an equipment-desk person
  changes the tool directly; a foreman without `asset.manage` gets the report
  recorded as a request the desk approves, instead of a hard permission error.
  This form never just annotates — for a plain observation that changes nothing,
  use "Add a note".
*/
export function ReportForm({ open, onClose, assetId, assetCode }: Props) {
  const utils = trpc.useUtils();
  const [issueType, setIssueType] = useState<"in_maintenance" | "lost">("in_maintenance");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /* Once a report is in, the request is recorded whether or not it applied —
     so the dialog switches to a terminal message instead of letting "Cancel"
     pretend it went nowhere. */
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async () => {
    setSubmitting(true);
    setMessage("");
    try {
      const res = await utils.client.action.submit.mutate({
        type: issueType === "lost" ? "lost" : "repair",
        assetIds: [assetId],
        note: note || undefined,
      });
      utils.asset.list.invalidate();
      utils.asset.get.invalidate({ id: assetId });
      utils.transaction.list.invalidate({ assetId });
      utils.dashboard.kpis.invalidate();
      utils.dashboard.recentActivity.invalidate();
      utils.dashboard.pendingApprovals.invalidate();
      if (res.outcome === "applied") {
        onClose();
        return;
      }
      setSent(true);
      setMessage(
        res.outcome === "awaiting_approval"
          ? "Sent to the equipment desk for a second signature — the tool has not changed yet."
          : "Sent as a request. The equipment desk makes this change.",
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not submit the report. Try again.");
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && (sent ? onClose() : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
        </DialogHeader>
        {sent ? (
          <p className="text-sm text-warn">{message}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Reporting: <span className="font-medium text-foreground">{assetCode}</span>
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Issue type</label>
              <EntityField
                value={issueType}
                onChange={(v) => setIssueType(v as "in_maintenance" | "lost")}
                placeholder="What is wrong"
                options={[
                  { value: "in_maintenance", label: "Needs repair / maintenance" },
                  { value: "lost", label: "Lost / missing" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Note</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Describe the issue..."
                className="flex min-h-[80px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground resize-y"
              />
            </div>
            {message && <p className="text-sm text-destructive">{message}</p>}
          </div>
        )}
        <DialogFooter>
          {sent ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? "Sending…" : "Report"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
