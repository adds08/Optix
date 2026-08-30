"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CUSTODIAN_ROLES } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityField, type EntityOption } from "@/components/ui/entity-picker";
import { RidePicker } from "./ride-picker";
import { useViewTier } from "./use-permissions";
import { humanize } from "./sti/status";

/*
  One dialog for moving a selection of tools — the bulk path that turns the
  register from "one tool at a time" into "everything selected, one hand-off".

  It speaks the same language as TransferForm (custodian, project, container)
  and routes through `action.submit`, so the ledger gets one `transfer` event
  per tool and the high-value approval gate still applies per tool. The desk
  moves them immediately; a foreman's move parks for a second signature.

  The shared executor caps a batch at 50, so larger selections are submitted
  in chunks and the counts are summed.
*/

const MAX_BULK = 50;

type Props = {
  open: boolean;
  onClose: () => void;
  assetIds: string[];
  assetLabels: Record<string, string>;
  /* Called once every tool moved and nothing is waiting — the page clears its
     selection. */
  onApplied?: () => void;
};

export function BulkMoveForm({ open, onClose, assetIds, assetLabels, onApplied }: Props) {
  const tier = useViewTier();
  const utils = trpc.useUtils();
  const myForemen = trpc.employee.myForemen.useQuery(undefined, { enabled: tier === "assets.view.crew" });
  const foremen = trpc.employee.list.useQuery();
  const projects = trpc.project.list.useQuery();
  const locations = trpc.location.list.useQuery();

  let custodianOptions =
    foremen.data?.filter(
      (e) =>
        CUSTODIAN_ROLES.includes(e.role as (typeof CUSTODIAN_ROLES)[number]) &&
        e.employmentStatus === "active",
    ) ?? [];
  /* STI-307: the crew tier, not the role name. */
  if (tier === "assets.view.crew") {
    const ids = new Set(myForemen.data?.map((f) => f.id) ?? []);
    custodianOptions = custodianOptions.filter((e) => ids.has(e.id));
  }

  /* Code before name — see transfer-form.tsx, which this dialog otherwise
     mirrors field for field. */
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
      hint: [humanize(l.type), l.projectName ?? l.warehouseName, l.custodianName ? `held by ${l.custodianName}` : null]
        .filter(Boolean)
        .join(" · "),
    }));

  const [custodianId, setCustodianId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [locationId, setLocationId] = useState("");
  /* Which rig the batch rides out in (STI-203). Never auto-filled — a tool
     does not inherit the recipient's truck; see ride-picker.tsx. */
  const [truckId, setTruckId] = useState("");
  const [trailerId, setTrailerId] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState("");
  const [pending, setPending] = useState(false);

  /* Tools go where the foreman is: picking a custodian pre-fills the project
     from their current job. It stays editable — a default, not a lock. The
     truck is NOT pre-filled (STI-203): a tool does not inherit the truck of
     whoever receives it — the ride is recorded only when somebody says so. */
  const autoFilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!custodianId || autoFilledFor.current === custodianId) return;
    const emp = foremen.data?.find((e) => e.id === custodianId);
    if (emp?.primaryProjectId) setProjectId(emp.primaryProjectId);
    autoFilledFor.current = custodianId;
  }, [custodianId, foremen.data]);

  const invalidate = () => {
    utils.transfer.list.invalidate();
    utils.assignment.list.invalidate();
    utils.asset.list.invalidate();
    utils.dashboard.kpis.invalidate();
    utils.dashboard.pendingApprovals.invalidate();
    utils.dashboard.recentActivity.invalidate();
  };

  const mutation = trpc.action.submit.useMutation({ onSuccess: invalidate });

  const sample = useMemo(
    () => assetIds.slice(0, 4).map((id) => assetLabels[id] ?? "Untagged tool"),
    [assetIds, assetLabels],
  );

  const submit = async () => {
    if (!custodianId && !projectId && !locationId) return;
    setResult("");
    setPending(false);
    try {
      let applied = 0;
      let awaitingApproval = 0;
      let requested = false;
      for (let i = 0; i < assetIds.length; i += MAX_BULK) {
        const res = await mutation.mutateAsync({
          type: "transfer",
          assetIds: assetIds.slice(i, i + MAX_BULK),
          custodianId: custodianId || undefined,
          projectId: projectId || undefined,
          locationId: locationId || undefined,
          truckId: truckId || undefined,
          trailerId: trailerId || undefined,
          note: note || undefined,
        });
        applied += res.applied;
        awaitingApproval += res.awaitingApproval;
        if (res.taskId) requested = true;
      }

      if (requested) {
        setPending(true);
        setResult("Sent to the equipment desk as a request. Nothing moved yet — the desk decides.");
      } else if (awaitingApproval > 0) {
        setPending(true);
        setResult(
          `${awaitingApproval} tool${awaitingApproval === 1 ? "" : "s"} above the value that needs a second signature — they stay where they are until approved.` +
            (applied > 0 ? ` ${applied} moved now.` : ""),
        );
      } else {
        onApplied?.();
        onClose();
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Could not save. Try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move {assetIds.length} tool{assetIds.length === 1 ? "" : "s"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {assetIds.length > 4 ? (
              <>
                <span className="font-medium text-foreground">{sample.join(", ")}</span> and{" "}
                {assetIds.length - 4} more
              </>
            ) : (
              sample.join(", ")
            )}
          </p>

          <div className="space-y-2">
            <label className="text-sm font-medium">To custodian</label>
            <EntityField
              options={custodianEntityOptions}
              value={custodianId}
              onChange={setCustodianId}
              placeholder="No change"
              searchPlaceholder="Name or employee code"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">To project</label>
            <EntityField
              options={projectEntityOptions}
              value={projectId}
              onChange={setProjectId}
              placeholder="No change"
              searchPlaceholder="Project name or code"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">To gang box / place</label>
            {/* Vehicles are filtered out since STI-203: "in a truck" is the
                rig fields below, a per-assignment fact — not a location. */}
            <EntityField
              options={locationEntityOptions}
              value={locationId}
              onChange={setLocationId}
              placeholder="No change"
              searchPlaceholder="Yard, gang box or container"
            />
            <p className="text-xs text-muted-foreground">
              A foreman, a project, a place and the rig can all change at once — or just one of them.
            </p>
          </div>

          <RidePicker truckId={truckId} trailerId={trailerId} onTruck={setTruckId} onTrailer={setTrailerId} />

          <div className="space-y-2">
            <label className="text-sm font-medium">Note</label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why they are moving — this goes on every tool's ledger entry"
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
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={mutation.isPending || (!custodianId && !projectId && !locationId)}
              >
                {mutation.isPending ? "Moving…" : "Move"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
