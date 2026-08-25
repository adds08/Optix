"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { CUSTODIAN_ROLES, formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RidePicker } from "@/components/ride-picker";
import { money } from "@/lib/format";

/*
  The two directions of "give a tool to a person", behind one dialog:

    pickForeman  — a batch of loose tools was selected on a card; pick the
                   foreman to hand them to. One row per foreman, showing where
                   they work and their rig, so "this hand-off moves the tool
                   to their job" is never a surprise.
    pickTools    — a crew's "Add tools" action; pick unheld tools from the
                   same job and the yard to give to that foreman.

  Both end in `assignment.create`, which is the same custody move the rest of
  the system uses: the tool's project follows the foreman (projectForCustodian),
  the previous custody link closes, and a high-value hand-off parks for
  approval instead of applying silently.
*/

export type CrewAssignRequest =
  | { mode: "pickForeman"; assetIds: string[] }
  | { mode: "pickTools"; foremanId: string; foremanName: string };

type LooseTool = {
  id: string;
  tag: string | null;
  serialNumber: string | null;
  make: string | null;
  modelNumber: string | null;
  description: string | null;
  acquisitionCost: string | null;
  status?: string | null;
  custodianId?: string | null;
  locationName?: string | null;
};

type Row = {
  key: string;
  title: string;
  meta: string;
  location?: string | null;
  onSelect?: () => void;
};

export function CrewAssignDialog({
  request,
  onClose,
  onDone,
}: {
  request: CrewAssignRequest | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const employees = trpc.employee.list.useQuery();
  const assets = trpc.asset.list.useQuery();
  const vehicles = trpc.vehicle.list.useQuery();

  const assign = trpc.assignment.create.useMutation();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const foremen = useMemo(
    () =>
      (employees.data ?? []).filter(
        (e) =>
          e.employmentStatus === "active" &&
          CUSTODIAN_ROLES.includes(e.role as (typeof CUSTODIAN_ROLES)[number]),
      ),
    [employees.data],
  );

  /* Tools nobody is holding — the pool for "give to this foreman". Maintenance
     and lost kit is not hand-over-able (the register says so too), so it is
     kept out of the pool. */
  const loose = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (assets.data ?? [])
      .filter(
        (t) =>
          !t.custodianId &&
          t.status !== "in_maintenance" &&
          t.status !== "lost" &&
          (!needle ||
            `${t.tag ?? ""} ${t.serialNumber ?? ""} ${t.locationName ?? ""} ${formatAssetModel(t)}`
              .toLowerCase()
              .includes(needle)),
      )
      .slice(0, 60) as LooseTool[];
  }, [assets.data, q]);

  const invalidate = () => {
    utils.asset.list.invalidate();
    utils.vehicle.list.invalidate();
    utils.employee.list.invalidate();
  };

  const giveTo = async (assetIds: string[], custodianId: string, truckId: string, trailerId: string) => {
    setBusy(true);
    setError("");
    try {
      for (const assetId of assetIds) {
        await assign.mutateAsync({
          assetId,
          custodianId,
          truckId: truckId || undefined,
          trailerId: trailerId || undefined,
        });
      }
      invalidate();
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That hand-off did not go through. Try again.");
    }
    setBusy(false);
  };

  /* Every hand-off confirms first — a batch of tools leaving the yard for a
     person is not a stray-click decision. */
  const [confirm, setConfirm] = useState<{ title: string; body: string; assetIds: string[]; custodianId: string; foremanName: string } | null>(null);
  /* Which rig the batch rides out in (STI-203), asked on the confirm step.
     Never pre-filled from the foreman's rig — a tool does not inherit the
     truck of whoever receives it; see ride-picker.tsx. */
  const [rideTruckId, setRideTruckId] = useState("");
  const [rideTrailerId, setRideTrailerId] = useState("");

  /* All hooks run before any return — `request` may be null, in which case the
     memo yields nothing and the dialog renders null below. */
  const needle = q.trim().toLowerCase();
  const match = (s: string) => !needle || s.toLowerCase().includes(needle);

  const crewName = request?.mode === "pickTools" ? request.foremanName : "";

  const rows = useMemo((): Row[] => {
    if (!request) return [];
    if (request.mode === "pickForeman") {
      return foremen
        .filter((f) => match(`${f.externalId ?? ""} ${f.name} ${f.primaryProjectName ?? ""}`))
        .map((f) => {
          const truck = (vehicles.data ?? []).find(
            (v) => v.vehicleType === "truck" && v.foremanEmployeeId === f.id,
          );
          return {
            key: f.id,
            title: f.externalId ? `${f.externalId} · ${f.name}` : f.name,
            meta: truck
              ? `${f.primaryProjectName ?? "Not assigned to a project"} · rig ${truck.unit}`
              : f.primaryProjectName ?? "Not assigned to a project",
            onSelect: () =>
              setConfirm({
                title: `Hand ${request.assetIds.length} tool${request.assetIds.length === 1 ? "" : "s"} to ${f.name}?`,
                body: `The tool${request.assetIds.length === 1 ? " goes" : "s go"} where ${f.name} works — ${f.primaryProjectName ?? "they are not on a project right now"}.`,
                assetIds: request.assetIds,
                custodianId: f.id,
                foremanName: f.name,
              }),
          };
        });
    }
    return loose.map((t) => ({
      key: t.id,
      title: t.tag ?? t.serialNumber ?? "Untagged",
      meta: `${formatAssetModel(t) || "No description"} · ${money(t.acquisitionCost)}`,
      location: t.locationName ?? null,
    }));
  }, [request, foremen, loose, vehicles.data, q]);

  if (!request) return null;

  const title =
    request.mode === "pickForeman"
      ? `Hand ${request.assetIds.length} tool${request.assetIds.length === 1 ? "" : "s"} to a foreman`
      : `Add tools to ${crewName}`;

  const note =
    request.mode === "pickForeman"
      ? "The tool goes where the foreman works — picking someone moves it to their job."
      : "Only tools nobody is holding are listed. A picked tool moves to this foreman's job.";

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
        <p className="-mt-2 text-sm text-muted-foreground">{note}</p>

        <div className="overflow-hidden rounded-md border">
          <div className="flex h-9 items-center gap-2 border-b px-3">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={request.mode === "pickForeman" ? "Search foremen…" : "Search tools…"}
              className="h-auto border-0 p-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {rows.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">Nothing matches “{q}”.</p>
            ) : request.mode === "pickForeman" ? (
              rows.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  disabled={busy}
                  onClick={r.onSelect}
                  className="flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                >
                  <span className="grid size-4 shrink-0 place-items-center rounded-full border border-input">
                    <Check className="size-3 opacity-0" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.meta}</span>
                  </span>
                </button>
              ))
            ) : (
              rows.map((r) => {
                const on = picked.has(r.key);
                return (
                  <label
                    key={r.key}
                    className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setPicked((s) => {
                          const next = new Set(s);
                          if (next.has(r.key)) next.delete(r.key);
                          else next.add(r.key);
                          return next;
                        })
                      }
                      className="size-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.meta}</span>
                    </span>
                    {r.location ? (
                      <span className="shrink-0 rounded border bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {r.location}
                      </span>
                    ) : null}
                  </label>
                );
              })
            )}
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          {request.mode === "pickTools" ? (
            <Button
              disabled={busy || picked.size === 0}
              onClick={() =>
                setConfirm({
                  title: `Give ${picked.size} tool${picked.size === 1 ? "" : "s"} to ${crewName}?`,
                  body: `The tool${picked.size === 1 ? " goes" : "s go"} into ${crewName}'s custody and to their job.`,
                  assetIds: [...picked],
                  custodianId: request.foremanId,
                  foremanName: crewName,
                })
              }
            >
              {busy ? "Handing over…" : `Give ${picked.size || "…"} tool${picked.size === 1 ? "" : "s"} to ${crewName}`}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Every hand-off confirms here first. */}
    <Dialog open={!!confirm} onOpenChange={(o) => { if (!o) { setConfirm(null); setRideTruckId(""); setRideTrailerId(""); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{confirm?.title}</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-sm text-muted-foreground">{confirm?.body}</p>
        <RidePicker truckId={rideTruckId} trailerId={rideTrailerId} onTruck={setRideTruckId} onTrailer={setRideTrailerId} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={() => {
              const c = confirm;
              setConfirm(null);
              if (c) giveTo(c.assetIds, c.custodianId, rideTruckId, rideTrailerId);
              setRideTruckId("");
              setRideTrailerId("");
            }}
          >
            {busy ? "Handing over…" : `Yes, hand to ${confirm?.foremanName ?? "them"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
