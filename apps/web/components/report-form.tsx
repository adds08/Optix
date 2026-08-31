"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EntityField } from "@/components/ui/entity-picker";

type Props = { open: boolean; onClose: () => void; assetId: string; assetTag: string };

export function ReportForm({ open, onClose, assetId, assetTag }: Props) {
  const utils = trpc.useUtils();
  const [issueType, setIssueType] = useState<"lost" | "in_maintenance">("in_maintenance");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.asset.setStatus.mutate({ id: assetId, status: issueType, note: note || undefined });
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
      utils.dashboard.recentActivity.invalidate();
      onClose();
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Could not save. Try again.");
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report Issue</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Reporting: <span className="font-medium text-foreground">{assetTag}</span></p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Issue type</label>
            <EntityField
              value={issueType}
              onChange={(v) => setIssueType(v as "lost" | "in_maintenance")}
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
          {result && <p className="text-sm text-destructive">{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? "..." : "Report"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
