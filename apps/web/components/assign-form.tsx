"use client";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePermissions } from "./use-permissions";

type Props = { open: boolean; onClose: () => void; preselectedAssetId?: string };

export function AssignForm({ open, onClose, preselectedAssetId }: Props) {
  const { role, has } = usePermissions();
  const utils = trpc.useUtils();
  const assets = trpc.asset.list.useQuery({ status: "available" });
  const projects = trpc.project.list.useQuery();
  const locations = trpc.location.list.useQuery();
  const foremen = trpc.employee.list.useQuery();
  const myForemen = trpc.employee.myForemen.useQuery(undefined, { enabled: role === "superintendent" });
  const me = trpc.identity.me.useQuery();

  const isSuper = role === "superintendent";
  const isWarehouseOrAdmin = has("employee.manage");

  let custodianOptions = foremen.data?.filter((e) => e.role === "foreman" && e.employmentStatus === "active") ?? [];
  if (isSuper) {
    const myForemanIds = new Set(myForemen.data?.map((f) => f.id) ?? []);
    custodianOptions = custodianOptions.filter((e) => myForemanIds.has(e.id));
  } else if (!isWarehouseOrAdmin) {
    custodianOptions = custodianOptions.filter((e) => e.id === me.data?.employeeId);
  }

  const [assetId, setAssetId] = useState(preselectedAssetId ?? "");
  const [custodianId, setCustodianId] = useState("");
  const [projectId, setProjectId] = useState("");
  /* Where it physically goes. Assigning a tool to a foreman almost always
     means it is going in their trailer or gang box, and without this the only
     way to record that was a separate Transfer afterwards. */
  const [locationId, setLocationId] = useState("");
  const [type, setType] = useState<"permanent" | "temporary">("permanent");
  const [expectedEnd, setExpectedEnd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  useEffect(() => { setAssetId(preselectedAssetId ?? ""); }, [preselectedAssetId]);

  const submit = async () => {
    if (!assetId || !custodianId) return;
    setSubmitting(true);
    setResult("");
    try {
      const res = await utils.client.assignment.create.mutate({
        assetId, custodianId, projectId: projectId || undefined,
        locationId: locationId || undefined,
        type, expectedEnd: expectedEnd || undefined,
      });
      setResult(res.needsApproval ? "Pending approval" : "Assigned!");
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
          <DialogTitle>Assign Tool</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Asset</label>
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">Select asset...</option>
              {assets.data?.map((a) => (
                <option key={a.id} value={a.id}>{a.tag} — {a.modelName}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Custodian</label>
            <select value={custodianId} onChange={(e) => setCustodianId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">Select custodian...</option>
              {custodianOptions.map((e) => (
                <option key={e.id} value={e.id}>{e.name} {e.externalId ? `#${e.externalId}` : ""}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Project</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">Default (custodian's primary)</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Where it goes</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">Leave where it is</option>
              {locations.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.custodianName ? ` — ${l.custodianName}` : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              A truck, trailer or gang box, if the tool is going into one.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as "permanent" | "temporary")} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="permanent">Permanent</option>
              <option value="temporary">Temporary (loan)</option>
            </select>
          </div>
          {type === "temporary" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Expected end date</label>
              <Input type="date" value={expectedEnd} onChange={(e) => setExpectedEnd(e.target.value)} />
            </div>
          )}
          {result && <p className="text-sm text-destructive">{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !assetId || !custodianId}>{submitting ? "..." : "Assign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
