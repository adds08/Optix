"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CUSTODIAN_ROLES } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePermissions } from "./use-permissions";

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
  const { role } = usePermissions();
  const utils = trpc.useUtils();
  const myForemen = trpc.employee.myForemen.useQuery(undefined, { enabled: role === "superintendent" });
  const foremen = trpc.employee.list.useQuery();
  const projects = trpc.project.list.useQuery();
  const locations = trpc.location.list.useQuery();
  const vehicles = trpc.vehicle.list.useQuery();

  let custodianOptions =
    foremen.data?.filter(
      (e) =>
        CUSTODIAN_ROLES.includes(e.role as (typeof CUSTODIAN_ROLES)[number]) &&
        e.employmentStatus === "active",
    ) ?? [];
  if (role === "superintendent") {
    const ids = new Set(myForemen.data?.map((f) => f.id) ?? []);
    custodianOptions = custodianOptions.filter((e) => ids.has(e.id));
  }

  const [custodianId, setCustodianId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState("");
  const [pending, setPending] = useState(false);

  /* Tools go where the foreman is: picking a custodian pre-fills the project
     from their current job and their truck. Both stay editable — a default,
     not a lock. */
  const autoFilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!custodianId || autoFilledFor.current === custodianId) return;
    const emp = foremen.data?.find((e) => e.id === custodianId);
    if (emp?.primaryProjectId) setProjectId(emp.primaryProjectId);
    const truck = vehicles.data?.find((v) => v.vehicleType === "truck" && v.foremanEmployeeId === custodianId);
    if (truck?.locationId) setLocationId(truck.locationId);
    autoFilledFor.current = custodianId;
  }, [custodianId, foremen.data, vehicles.data]);

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
      let awaitingVerification = 0;
      let requested = false;
      for (let i = 0; i < assetIds.length; i += MAX_BULK) {
        const res = await mutation.mutateAsync({
          type: "transfer",
          assetIds: assetIds.slice(i, i + MAX_BULK),
          custodianId: custodianId || undefined,
          projectId: projectId || undefined,
          locationId: locationId || undefined,
          note: note || undefined,
        });
        applied += res.applied;
        awaitingApproval += res.awaitingApproval;
        awaitingVerification += res.awaitingVerification;
        if (res.taskId) requested = true;
      }

      if (requested) {
        setPending(true);
        setResult("Sent to the equipment desk as a request. Nothing moved yet — the desk decides.");
      } else if (awaitingApproval > 0) {
        setPending(true);
        setResult(
          `${awaitingApproval} tool${awaitingApproval === 1 ? "" : "s"} above the value that needs a second signature — they stay where they are until approved in the Inbox.` +
            (applied > 0 ? ` ${applied} moved now.` : ""),
        );
      } else if (awaitingVerification > 0) {
        setPending(true);
        setResult(
          "Recorded as loans — the tools moved and are in front of the equipment desk, who will confirm them.",
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
            <select
              value={custodianId}
              onChange={(e) => setCustodianId(e.target.value)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">No change</option>
              {custodianOptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">To project</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">No change</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">To truck / trailer / gang box</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">No change</option>
              {locations.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.custodianName ? ` — ${l.custodianName}` : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              A foreman, a project and a container can all change at once — or just one of them.
            </p>
          </div>

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
