"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROJECT_STATUSES, type ProjectStatus } from "@stinventory/types";
import { EntityField } from "@/components/ui/entity-picker";

/* Sentence case for the select; the values themselves come from the shared
   enum, so a new status appears here without an edit and cannot appear here
   WITHOUT the server accepting it. */
const STATUS_LABELS: Record<ProjectStatus, string> = {
  not_awarded: "Not awarded",
  awarded: "Awarded",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  on_hold: "On hold",
};

export type ProjectEditable = {
  id: string;
  name: string;
  externalId?: string | null;
  description?: string | null;
  status?: string | null;
  siteAddress?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

type Props = { open: boolean; onClose: () => void; edit?: ProjectEditable };

export function ProjectForm({ open, onClose, edit }: Props) {
  const utils = trpc.useUtils();

  const [name, setName] = useState(edit?.name ?? "");
  const [externalId, setExternalId] = useState(edit?.externalId ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  /* A job loaded from an older row could carry anything — the column is plain
     text and only became an enum in STI-105 — so an unrecognised value falls
     back to "not_awarded" rather than rendering a select with no selection. */
  const [status, setStatus] = useState<ProjectStatus>(
    PROJECT_STATUSES.includes(edit?.status as ProjectStatus) ? (edit!.status as ProjectStatus) : "not_awarded",
  );
  const [siteAddress, setSiteAddress] = useState(edit?.siteAddress ?? "");
  const [startDate, setStartDate] = useState(edit?.startDate ?? "");
  const [endDate, setEndDate] = useState(edit?.endDate ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    if (!name || !startDate) return;
    setSubmitting(true);
    setResult("");
    try {
      if (edit) {
        await utils.client.project.update.mutate({
          id: edit.id, name, status, startDate,
          externalId: externalId || null,
          description: description || null,
          siteAddress: siteAddress || null,
          endDate: endDate || null,
        });
      } else {
        await utils.client.project.create.mutate({
          name, externalId: externalId || undefined, status, startDate,
          description: description || undefined,
          siteAddress: siteAddress || undefined,
          endDate: endDate || undefined,
        });
      }
      utils.project.list.invalidate();
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
          <DialogTitle>{edit ? `Edit ${edit.name}` : "New Project"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project Code</label>
              <Input value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <EntityField
                value={status}
                onChange={(v) => setStatus(v as ProjectStatus)}
                placeholder="Status"
                options={PROJECT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="flex w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Site address</label>
            <Input
              value={siteAddress}
              onChange={(e) => setSiteAddress(e.target.value)}
              placeholder="7501 Windrose Ave, Plano TX"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Start date *</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">End date</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          {result && <p className="text-sm text-destructive">{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name || !startDate}>{submitting ? "..." : edit ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
