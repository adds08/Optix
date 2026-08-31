"use client";
import { useEffect, useRef, useState } from "react";
import { CUSTODIAN_ROLES } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EntityField, type EntityOption } from "@/components/ui/entity-picker";
import { RidePicker } from "./ride-picker";
import { useViewTier } from "./use-permissions";
import { humanize } from "./sti/status";

type Props = { open: boolean; onClose: () => void; assetId: string; assetTag: string };

export function TransferForm({ open, onClose, assetId, assetTag }: Props) {
  const tier = useViewTier();
  const utils = trpc.useUtils();
  const myForemen = trpc.employee.myForemen.useQuery(undefined, { enabled: tier === "assets.view.crew" });
  const foremen = trpc.employee.list.useQuery();
  const projects = trpc.project.list.useQuery();
  const locations = trpc.location.list.useQuery();

  let custodianOptions =
    foremen.data?.filter((e) => CUSTODIAN_ROLES.includes(e.role as (typeof CUSTODIAN_ROLES)[number]) && e.employmentStatus === "active") ?? [];
  /* STI-307: the crew tier, not the role name. */
  if (tier === "assets.view.crew") {
    const ids = new Set(myForemen.data?.map((f) => f.id) ?? []);
    custodianOptions = custodianOptions.filter((e) => ids.has(e.id));
  }

  /* Code before name, everywhere an entity is offered — a plain <select> of
     names is unfilterable and unidentifiable the moment two people share a
     first name, which is exactly what these three fields looked like before.
     `location` has no code column today, so its hint is what actually
     distinguishes one from another: kind, plus whichever job it belongs to. */
  const custodianEntityOptions: EntityOption[] = custodianOptions.map((e) => ({
    value: e.id, label: e.name, hint: e.externalId ?? undefined,
  }));
  const projectEntityOptions: EntityOption[] = (projects.data ?? []).map((p) => ({
    value: p.id, label: p.name, hint: p.externalId ?? undefined,
  }));
  const locationEntityOptions: EntityOption[] = (locations.data ?? [])
    .filter((l) => l.type !== "vehicle")
    .map((l) => ({
      value: l.id,
      label: l.name,
      hint: [humanize(l.type), l.projectName ?? l.warehouseName].filter(Boolean).join(" · "),
    }));

  const [toCustodianId, setToCustodianId] = useState("");
  const [toProjectId, setToProjectId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  /* Which rig it rides out in (STI-203). Never auto-filled — a tool does not
     inherit the recipient's truck; see ride-picker.tsx. */
  const [toTruckId, setToTruckId] = useState("");
  const [toTrailerId, setToTrailerId] = useState("");
  const [reason, setReason] = useState("reallocation");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");
  /* Distinguishes "it worked but is waiting" from "it failed" — both used to
     render in the same red text. */
  const [pending, setPending] = useState(false);

  /* Tools go where the foreman is: picking a recipient pre-fills the project
     from their current job. It stays editable — a default, not a lock. The
     truck is NOT pre-filled (STI-203): a tool does not inherit the truck of
     whoever receives it — the ride is recorded only when somebody says so. */
  const autoFilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!toCustodianId || autoFilledFor.current === toCustodianId) return;
    const emp = foremen.data?.find((e) => e.id === toCustodianId);
    if (emp?.primaryProjectId) setToProjectId(emp.primaryProjectId);
    autoFilledFor.current = toCustodianId;
  }, [toCustodianId, foremen.data]);

  /*
    Close only when the tool actually moved.

    The message was being set and the dialog closed on the next line, so the
    "Pending approval" case rendered for no frames at all. A transfer between
    two people always needs a second signature, which made that the ordinary
    outcome: the dialog vanished, the register was unchanged, and nothing said
    why. Now an approval-bound transfer keeps the dialog open long enough to say
    where it went.
  */
  const submit = async () => {
    if (!toCustodianId) return;
    setSubmitting(true);
    setResult("");
    setPending(false);
    try {
      const res = await utils.client.transfer.create.mutate({
        assetId, toCustodianId, toProjectId: toProjectId || undefined,
        toLocationId: toLocationId || undefined,
        toTruckId: toTruckId || undefined,
        toTrailerId: toTrailerId || undefined,
        reason,
      });
      utils.transfer.list.invalidate();
      utils.assignment.list.invalidate();
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
      utils.dashboard.pendingApprovals.invalidate();
      utils.dashboard.recentActivity.invalidate();
      if (res.outcome === "approve") {
        /* Held, not applied: the tool is worth enough that a second admin has
           to sign it off. Saying nothing here would leave the register looking
           unchanged for no visible reason. */
        setPending(true);
        setResult(
          "Sent for a second signature. This tool is worth enough that another administrator has to approve the move — it stays where it is until they do.",
        );
      } else {
        onClose();
      }
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
            <EntityField
              options={custodianEntityOptions}
              value={toCustodianId}
              onChange={setToCustodianId}
              placeholder="Select custodian..."
              searchPlaceholder="Name or employee code"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">To project</label>
            <EntityField
              options={projectEntityOptions}
              value={toProjectId}
              onChange={setToProjectId}
              placeholder="No change"
              searchPlaceholder="Project name or code"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">To location</label>
            {/* Vehicles are filtered out since STI-203: "in a truck" is the
                rig fields below, a per-assignment fact — not a location. */}
            <EntityField
              options={locationEntityOptions}
              value={toLocationId}
              onChange={setToLocationId}
              placeholder="No change"
              searchPlaceholder="Yard, gang box or container"
            />
          </div>
          <RidePicker truckId={toTruckId} trailerId={toTrailerId} onTruck={setToTruckId} onTrailer={setToTrailerId} />
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason</label>
            <EntityField
              value={reason}
              onChange={setReason}
              placeholder="Why it is moving"
              options={[
                { value: "reallocation", label: "Reallocation" },
                { value: "project_complete", label: "Project complete" },
                { value: "hr_offboarding", label: "HR offboarding" },
                { value: "repair", label: "Repair" },
                { value: "handoff", label: "Handoff" },
              ]}
            />
          </div>
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
              <Button onClick={submit} disabled={submitting || !toCustodianId}>
                {submitting ? "Sending…" : "Transfer"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
