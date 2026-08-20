"use client";
import { useEffect, useRef, useState } from "react";
import { CUSTODIAN_ROLES, formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RidePicker } from "./ride-picker";
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

  let custodianOptions =
    foremen.data?.filter((e) => CUSTODIAN_ROLES.includes(e.role as (typeof CUSTODIAN_ROLES)[number]) && e.employmentStatus === "active") ?? [];
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
  /* Which rig it rides out in (STI-203). Deliberately never auto-filled: the
     project follows the person, the truck does not — see ride-picker.tsx. */
  const [truckId, setTruckId] = useState("");
  const [trailerId, setTrailerId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");
  /* Same fix as transfer-form: "waiting" is a success, not a failure, and it
     needs the dialog to stay open long enough to be read. */
  const [pending, setPending] = useState(false);

  useEffect(() => { setAssetId(preselectedAssetId ?? ""); }, [preselectedAssetId]);

  /* Tools go where the foreman is: picking a custodian pre-fills the project
     from their current job. It stays editable — a default, not a lock.
     The truck is NOT pre-filled (STI-203): it used to be, via the truck's
     location row, but a tool does not inherit the truck of whoever receives
     it — the ride is recorded only when somebody says so. */
  const autoFilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!custodianId || autoFilledFor.current === custodianId) return;
    const emp = foremen.data?.find((e) => e.id === custodianId);
    if (emp?.primaryProjectId) setProjectId(emp.primaryProjectId);
    autoFilledFor.current = custodianId;
  }, [custodianId, foremen.data]);

  const submit = async () => {
    if (!assetId || !custodianId) return;
    setSubmitting(true);
    setResult("");
    try {
      const res = await utils.client.assignment.create.mutate({
        assetId, custodianId, projectId: projectId || undefined,
        locationId: locationId || undefined,
        truckId: truckId || undefined,
        trailerId: trailerId || undefined,
      });
      if (res.needsApproval) {
        setPending(true);
        setResult(
          /* Names the queue tab on /custody, not the Inbox — the inbox handles
             tasks and messages and cannot act on an assignment row (STI-105). */
          "Sent to the equipment desk. This tool is above the value that needs a second signature — it stays where it is until someone approves it in the Custody approval queue.",
        );
      }
      utils.assignment.list.invalidate();
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
      utils.dashboard.pendingApprovals.invalidate();
      utils.dashboard.recentActivity.invalidate();
      /* Close only when the register actually changed. */
      if (!res.needsApproval) onClose();
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
                <option key={a.id} value={a.id}>{a.tag ?? "Untagged"} — {formatAssetModel(a) || "No description"}</option>
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
            {/* Vehicles are filtered out since STI-203: "in a truck" is the
                rig fields below, a per-assignment fact — not a location. Old
                rows that recorded a vehicle here stay valid (schema/asset.ts). */}
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">Leave where it is</option>
              {locations.data?.filter((l) => l.type !== "vehicle").map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.custodianName ? ` — ${l.custodianName}` : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              A gang box, yard or warehouse, if the tool is going into one.
            </p>
          </div>
          <RidePicker truckId={truckId} trailerId={trailerId} onTruck={setTruckId} onTrailer={setTrailerId} />
          {result ? (
            <p
              className={`rounded-md border px-3 py-2 text-sm ${
                pending ? "border-warn/40 bg-warn-bg text-warn" : "border-destructive/40 text-destructive"
              }`}
            >
              {result}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {pending ? (
            <Button onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={submitting || !assetId || !custodianId}>
                {submitting ? "Saving…" : "Assign"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
