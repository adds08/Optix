"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rigOf } from "@/lib/rig";
import { cn } from "@/lib/utils";

/*
  Everything you can hang on a crew, behind one searchable dialog.

  Each branch maps onto an existing procedure — none of this needs new API:

    truck    location.setCustodian { locationId: truck.locationId, custodianEmployeeId }
             (the hitched trailer and every tool aboard follow — see location.ts)
    trailer  vehicle.update { id: trailer.id, attachedToVehicleId: truck.id }
             (attaching to a truck that has a foreman moves custody on the spot)
    crew     projectTeam.assign { projectId, employeeId, role: "foreman" }
    move     same call with the new projectId

  The crew and move branches route through projectTeam.assign — the same move
  employee.assignToProject performs — so a foreman added to a job is actually
  POSTED there: their posting and primary project change, the roster row keeps
  in lockstep, and the truck, the hitched trailer and every tool aboard move
  together. Plain vehicle/placeVehicle relabeling would move the truck but
  leave the trailer, its tools, and the person behind.

  Search filters what is listed, never the selection, and each row says where
  the unit is right now so "assigning moves it" is never a surprise.
*/

export type PickerRequest =
  | { kind: "crew"; projectId: string }
  | { kind: "truck"; foremanId: string }
  | { kind: "trailer"; foremanId: string; truckId?: string }
  | { kind: "move"; foremanId: string; projectId: string };

type Vehicle = {
  id: string;
  vehicleType: string;
  unit: string;
  makeModel: string | null;
  locationId: string;
  foremanEmployeeId: string | null;
  foremanName: string | null;
  attachedToVehicleId: string | null;
  attachedToUnit: string | null;
  projectId: string | null;
  projectName: string | null;
};

type PickerRow = {
  key: string;
  title: string;
  meta: string;
  selected: boolean;
  disabled?: boolean;
  hint?: string;
  onSelect: () => void;
};

export function RigPicker({
  request,
  onClose,
  onDone,
  foremen,
  vehicles,
  projects,
}: {
  request: PickerRequest | null;
  onClose: () => void;
  onDone: () => void;
  foremen: { id: string; name: string; role: string; externalId?: string | null }[];
  vehicles: Vehicle[];
  projects: { id: string; name: string; externalId: string | null }[];
}) {
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* A unit currently with someone else needs an explicit "take it over"
     confirm before the move runs — the server removes it from the previous
     holder in the same transaction, but the desk decides that out loud. */
  const [takeover, setTakeover] = useState<{ title: string; body: string; run: () => void } | null>(null);

  const setCustodian = trpc.location.setCustodian.useMutation();
  const updateVehicle = trpc.vehicle.update.useMutation();
  const assignForeman = trpc.projectTeam.assign.useMutation();

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      utils.vehicle.list.invalidate();
      utils.asset.list.invalidate();
      utils.employee.list.invalidate();
      utils.project.list.invalidate();
      utils.projectTeam.all.invalidate();
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through. Try again.");
    }
    setBusy(false);
  };

  const rows = useMemo((): PickerRow[] => {
    if (!request) return [];
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);

    if (request.kind === "crew") {
      return foremen.filter((f) => match(`${f.externalId ?? ""} ${f.name} ${f.role}`)).map((f) => {
        const rig = rigOf(f.id, vehicles);
        const onJob = rig.truck?.projectId === request.projectId;
        return {
          key: f.id,
          title: f.externalId ? `${f.externalId} · ${f.name}` : f.name,
          meta: `${rig.truck ? rig.truck.unit : "no truck"}${rig.trailer ? ` + ${rig.trailer.unit}` : ""} · ${f.role}`,
          selected: !!onJob,
          disabled: !rig.truck,
          hint: rig.truck ? undefined : "Give them a truck first — the rig is what moves to a job.",
          onSelect: () =>
            run(() => assignForeman.mutateAsync({ projectId: request.projectId, employeeId: f.id, role: "foreman" })),
        };
      });
    }

    if (request.kind === "truck") {
      return vehicles.filter((v) => v.vehicleType === "truck" && match(`${v.unit} ${v.makeModel ?? ""}`)).map((v) => {
        const theirs = v.foremanEmployeeId === request.foremanId;
        const takenFrom = !theirs && v.foremanEmployeeId ? v.foremanName : null;
        return {
          key: v.id,
          title: `${v.unit}${v.makeModel ? ` · ${v.makeModel}` : ""}`,
          meta: theirs ? "Their truck" : takenFrom ? `With ${takenFrom} — taking it moves it` : "In the yard, free",
          selected: theirs,
          onSelect: () => {
            const apply = () =>
              run(() =>
                setCustodian.mutateAsync({
                  locationId: v.locationId,
                  custodianEmployeeId: theirs ? null : request.foremanId,
                  moveContents: true,
                }),
              );
            /* A truck with another foreman is not silently taken: it is
               removed from them first, with the hitched trailer and the tools
               aboard going along. */
            if (takenFrom) {
              setTakeover({
                title: `Take ${v.unit} from ${takenFrom}?`,
                body: `${v.unit} is currently with ${takenFrom}. Taking it removes it from them first — the hitched trailer and every tool aboard go with it.`,
                run: apply,
              });
            } else {
              apply();
            }
          },
        };
      });
    }

    if (request.kind === "trailer") {
      return vehicles.filter((v) => v.vehicleType === "trailer" && match(`${v.unit} ${v.makeModel ?? ""}`)).map((v) => {
        const here = v.attachedToVehicleId === request.truckId;
        const rehitchFrom = !here && v.attachedToVehicleId ? v.attachedToUnit : null;
        return {
          key: v.id,
          title: `${v.unit}${v.makeModel ? ` · ${v.makeModel}` : ""}`,
          meta: here ? "Hitched here" : rehitchFrom ? `Hitched to ${rehitchFrom} — re-hitching moves it` : "Unhitched, in the yard",
          selected: here,
          onSelect: () => {
            const apply = () =>
              run(() =>
                updateVehicle.mutateAsync({
                  id: v.id,
                  attachedToVehicleId: here ? null : request.truckId ?? null,
                }),
              );
            /* A trailer hitched to another truck cannot serve two trucks: it is
               taken off the first before being hitched to the second. */
            if (rehitchFrom) {
              setTakeover({
                title: `Re-hitch ${v.unit} from ${rehitchFrom}?`,
                body: `${v.unit} is currently hitched to ${rehitchFrom}. Re-hitching takes it off that truck first — if the new truck has a foreman, the trailer and its tools move to them.`,
                run: apply,
              });
            } else {
              apply();
            }
          },
        };
      });
    }

    /* move */
    const rig = rigOf(request.foremanId, vehicles);
    return projects.filter((p) => match(`${p.name} ${p.externalId ?? ""}`)).map((p) => ({
      key: p.id,
      title: p.name,
      meta: p.externalId ?? "",
      selected: rig.truck?.projectId === p.id,
      disabled: !rig.truck,
      onSelect: () =>
        run(() => assignForeman.mutateAsync({ projectId: p.id, employeeId: request.foremanId, role: "foreman" })),
    }));
  }, [request, q, foremen, vehicles, projects]);

  if (!request) return null;

  const foremanName = "foremanId" in request ? foremen.find((f) => f.id === request.foremanId)?.name ?? "this foreman" : "";
  const copy = {
    crew: {
      title: "Add a foreman to this job",
      note: "The foreman brings their own truck and trailer — the job gets another crew row.",
      placeholder: "Search people…",
    },
    truck: {
      title: `Truck for ${foremanName}`,
      note: "One truck per foreman. Handing it over takes the hitched trailer and every tool aboard with it.",
      placeholder: "Search unit or model…",
    },
    trailer: {
      title: `Trailer for ${foremanName}`,
      note: "One trailer, hitched to their truck. The small tools ride in it.",
      placeholder: "Search unit or model…",
    },
    move: {
      title: `Move ${foremanName} to another job`,
      note: "The rig and everything in it travels with them.",
      placeholder: "Search jobs…",
    },
  }[request.kind];

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
          </DialogHeader>
          <p className="-mt-2 text-sm text-muted-foreground">{copy.note}</p>

        <div className="overflow-hidden rounded-md border">
          <div className="flex h-9 items-center gap-2 border-b px-3">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={copy.placeholder} className="h-auto border-0 p-0 shadow-none focus-visible:ring-0" />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {rows.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">Nothing matches “{q}”.</p>
            ) : (
              rows.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  disabled={busy || r.disabled}
                  onClick={r.onSelect}
                  title={r.hint}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50",
                    r.selected && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", r.selected ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                    {r.selected ? <Check className="size-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.meta}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>

      {/* The "this unit is with someone else" confirm, on top of the picker. */}
      <Dialog open={!!takeover} onOpenChange={(o) => !o && setTakeover(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{takeover?.title}</DialogTitle>
          </DialogHeader>
          <p className="-mt-2 text-sm text-muted-foreground">{takeover?.body}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTakeover(null)}>Cancel</Button>
            <Button
              disabled={busy}
              onClick={() => {
                const t = takeover;
                setTakeover(null);
                t?.run();
              }}
            >
              Take it over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
