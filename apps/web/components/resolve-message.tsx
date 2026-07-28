"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityField } from "@/components/entity-field";

/*
  The desk turning a message the parser could not read into a record — or
  closing it because there is nothing to record.

  Every message has to end somewhere. Before this the unresolved queue had no
  controls at all and the screen simply said resolving them "is not built yet",
  so the only way to clear one was to redo the work in another screen and leave
  the message sitting there forever. A queue that cannot be emptied stops being
  read, and then the messages that DO matter get missed.

  The action list is the same one everywhere else uses, and it runs through the
  same executor, so a message resolved here is indistinguishable in the ledger
  from one confirmed in chat.
*/

const ACTIONS: { value: string; label: string; needsAsset: boolean; needsPerson?: boolean }[] = [
  { value: "assign", label: "Give a tool to someone", needsAsset: true, needsPerson: true },
  { value: "transfer", label: "Move a tool to someone else", needsAsset: true, needsPerson: true },
  { value: "return", label: "Return a tool to the yard", needsAsset: true },
  { value: "repair", label: "Send a tool for repair", needsAsset: true },
  { value: "lost", label: "Mark a tool missing", needsAsset: true },
  { value: "report", label: "Just record it as a note", needsAsset: true },
];

export function ResolveMessage({
  open,
  onClose,
  messageId,
  body,
}: {
  open: boolean;
  onClose: () => void;
  messageId: string;
  body: string;
}) {
  const utils = trpc.useUtils();

  const [actionType, setActionType] = useState("assign");
  const [assetId, setAssetId] = useState<{ id: string; label: string } | null>(null);
  const [custodianId, setCustodianId] = useState<{ id: string; label: string } | null>(null);
  const [projectId, setProjectId] = useState<{ id: string; label: string } | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const spec = ACTIONS.find((a) => a.value === actionType)!;
  const ready = !spec.needsAsset || !!assetId;
  const personReady = !spec.needsPerson || !!custodianId;

  const invalidate = () => {
    utils.messaging.pendingActions.invalidate();
    utils.asset.list.invalidate();
    utils.assignment.list.invalidate();
    utils.dashboard.kpis.invalidate();
  };

  const record = async () => {
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.messaging.manualEntry.mutate({
        messageId,
        actionType: actionType as "assign",
        assetIds: assetId ? [assetId.id] : [],
        custodianId: custodianId?.id,
        projectId: projectId?.id,
        note: note || undefined,
      });
      invalidate();
      onClose();
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Could not record that.");
    }
    setSubmitting(false);
  };

  const dismiss = async () => {
    const reason = window.prompt("Why is nothing being recorded?");
    if (reason === null) return;
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.messaging.dismiss.mutate({ messageId, reason: reason || undefined });
      invalidate();
      onClose();
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Could not dismiss that.");
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What should this record?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* The original words, verbatim. The desk is interpreting somebody
              else's message and needs to keep seeing exactly what was said. */}
          <p className="rounded-md bg-muted px-3 py-2 text-sm">{body}</p>

          <div className="space-y-2">
            <label className="text-sm font-medium">Action</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>

          <EntityField label="Tool" kind="asset" value={assetId} onChange={setAssetId} required />
          {spec.needsPerson ? (
            <EntityField label="Person" kind="employee" value={custodianId} onChange={setCustodianId} required />
          ) : null}
          <EntityField label="Job" kind="project" value={projectId} onChange={setProjectId} />

          <div className="space-y-2">
            <label className="text-sm font-medium">Note</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth keeping" />
          </div>

          {result && <p className="text-sm text-destructive">{result}</p>}
        </div>
        <DialogFooter className="sm:justify-between">
          {/* Dismiss sits apart from the primary action — it is the "nothing
              happened here" answer, not a cancel. */}
          <Button variant="outline" onClick={dismiss} disabled={submitting}>
            Nothing to record
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={record} disabled={submitting || !ready || !personReady}>
              {submitting ? "..." : "Record it"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
