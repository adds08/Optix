"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
  Post a person to a job.

  The checkbox is the important control on this dialog. Small tools belong to
  the foreman, not the site — when they change job the whole trailer goes with
  them — so moving the tools is the default and unticking it is the exception
  (a retroactive correction, where the tools already moved by hand).

  Nothing here touches which project PAID for a tool. That stays with whoever
  bought it no matter how many jobs it works.
*/
export function PostingForm({
  open,
  onClose,
  employeeId,
  employeeName,
  currentProjectId,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  currentProjectId?: string | null;
}) {
  const utils = trpc.useUtils();
  const projects = trpc.project.list.useQuery();

  const [projectId, setProjectId] = useState("");
  const [startedOn, setStartedOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [moveTools, setMoveTools] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  /* Offering the job they are already on would produce a posting that closes
     and reopens the same row for no reason. */
  const options = (projects.data ?? []).filter((p) => p.id !== currentProjectId);

  const submit = async () => {
    if (!projectId) return;
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.employee.assignToProject.mutate({
        employeeId,
        projectId,
        startedOn,
        note: note || undefined,
        moveTools,
      });
      utils.employee.get.invalidate({ id: employeeId });
      utils.employee.postings.invalidate({ employeeId });
      utils.employee.list.invalidate();
      utils.asset.list.invalidate();
      utils.report.byProject.invalidate();
      utils.report.byForeman.invalidate();
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
          <DialogTitle>Move {employeeName} to a job</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Project *</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">Select...</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.externalId ? `${p.name} — ${p.externalId}` : p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Starting</label>
            <Input type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          </div>

          <label className="flex items-start gap-2.5 rounded-md border p-3">
            <input
              type="checkbox"
              checked={moveTools}
              onChange={(e) => setMoveTools(e.target.checked)}
              className="mt-0.5 size-4"
            />
            <span className="text-sm">
              Move everything they are holding to the new job
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Tools travel with the foreman. Untick only to correct history where the tools
                were already moved separately. Who paid for each tool does not change either way.
              </span>
            </span>
          </label>

          <div className="space-y-2">
            <label className="text-sm font-medium">Note</label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Legacy West paused — moved to Trinity"
            />
          </div>

          {result && <p className="text-sm text-destructive">{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !projectId}>
            {submitting ? "..." : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
