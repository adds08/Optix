"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePermissions } from "./use-permissions";

type Props = { open: boolean; onClose: () => void; assetId: string; assetTag: string };

export function TransferForm({ open, onClose, assetId, assetTag }: Props) {
  const { role } = usePermissions();
  const utils = trpc.useUtils();
  const myForemen = trpc.employee.myForemen.useQuery(undefined, { enabled: role === "superintendent" });
  const foremen = trpc.employee.list.useQuery();
  const projects = trpc.project.list.useQuery();
  const locations = trpc.location.list.useQuery();

  let custodianOptions = foremen.data?.filter((e) => e.role === "foreman" && e.employmentStatus === "active") ?? [];
  if (role === "superintendent") {
    const ids = new Set(myForemen.data?.map((f) => f.id) ?? []);
    custodianOptions = custodianOptions.filter((e) => ids.has(e.id));
  }

  const [toCustodianId, setToCustodianId] = useState("");
  const [toProjectId, setToProjectId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [reason, setReason] = useState("reallocation");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    if (!toCustodianId) return;
    setSubmitting(true);
    setResult("");
    try {
      const res = await utils.client.transfer.create.mutate({
        assetId, toCustodianId, toProjectId: toProjectId || undefined,
        toLocationId: toLocationId || undefined, reason,
      });
      setResult(res.needsApproval ? "Pending approval" : "Transferred!");
      utils.transfer.list.invalidate();
      utils.assignment.list.invalidate();
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Transfer Tool</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Transferring: <span className="font-medium text-foreground">{assetTag}</span></p>
          <div className="space-y-2">
            <label className="text-sm font-medium">To custodian</label>
            <select value={toCustodianId} onChange={(e) => setToCustodianId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">Select custodian...</option>
              {custodianOptions.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">To project</label>
            <select value={toProjectId} onChange={(e) => setToProjectId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">No change</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">To location</label>
            <select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">No change</option>
              {locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="reallocation">Reallocation</option>
              <option value="project_complete">Project complete</option>
              <option value="phase_change">Phase change</option>
              <option value="hr_offboarding">HR offboarding</option>
              <option value="repair">Repair</option>
              <option value="handoff">Handoff</option>
            </select>
          </div>
          {result && <p className="text-sm text-destructive">{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !toCustodianId}>{submitting ? "..." : "Transfer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
