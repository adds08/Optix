"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = { open: boolean; onClose: () => void };

export function ProjectForm({ open, onClose }: Props) {
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [externalId, setExternalId] = useState("");
  const [status, setStatus] = useState("active");
  const [costCenter, setCostCenter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    if (!name) return;
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.project.create.mutate({
        name, externalId: externalId || undefined, status,
        costCenter: costCenter || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setResult("Created!");
      utils.project.list.invalidate();
      setTimeout(onClose, 1200);
    } catch {
      setResult("Error");
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">External ID</label>
              <Input value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                <option value="awarded">Awarded</option>
                <option value="active">Active</option>
                <option value="closing">Closing</option>
                <option value="complete">Complete</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Cost center</label>
            <Input value={costCenter} onChange={(e) => setCostCenter(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Start date</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">End date</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          {result && <p className={`text-sm ${result === "Error" ? "text-destructive" : "text-green-600"}`}>{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name}>{submitting ? "..." : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
