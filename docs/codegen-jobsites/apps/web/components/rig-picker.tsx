"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/*
  Everything you can hang on a crew, behind one searchable dialog.

  Each branch maps onto an existing procedure — none of this needs new API:

    truck    location.setCustodian { locationId: truck.locationId, custodianEmployeeId }
             (the hitched trailer and every tool aboard follow — see location.ts)
    trailer  vehicle.update { id: trailer.id, attachedToVehicleId: truck.id }
             (attaching to a truck that has a foreman moves custody on the spot)
    crew     the foreman is added to the job by moving their rig there:
             vehicle.update { id: truck.id, projectId }
    move     same call with the new projectId — the trailers hitched to that
             truck and the tools inside them travel too (project.ts does this
             on reassignment; keep the two paths consistent)

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
  foremen: { id: string; name: string; role: string }[];
  vehicles: Vehicle[];
  projects: { id: string; name: string; externalId: string | null }[];
}) {
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setCustodian = trpc.location.setCustodian.useMutation();
  const updateVehicle = trpc.vehicle.update.useMutation();

  const truckOf = (foremanId: string) => vehicles.find((v) => v.vehicleType === "truck" && v.foremanEmployeeId === foremanId) ?? null;
  const trailerOf = (truckId: string | undefined) =>
    truckId ? vehicles.find((v) => v.vehicleType === "trailer" && v.attachedToVehicleId === truckId) ?? null : null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      utils.vehicle.list.invalidate();
      utils.asset.list.invalidate();
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through. Try again.");
    }
    setBusy(false);
  };

  const rows = useMemo(() => {
    if (!request) return [];
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);

    if (request.kind === "crew") {
      return foremen.filter((f) => match(`${f.name} ${f.role}`)).map((f) => {
        const truck = truckOf(f.id);
        const trailer = trailerOf(truck?.id);
        const onJob = truck?.projectId === request.projectId;
        return {
          key: f.id,
          title: f.name,
          meta: `${truck ? truck.unit : "no truck"}${trailer ? ` + ${trailer.unit}` : ""} · ${f.role}`,
          selected: !!onJob,
          disabled: !truck,
          hint: truck ? undefined : "Give them a truck first — the rig is what moves to a job.",
          onSelect: () => truck && run(() => updateVehicle.mutateAsync({ id: truck.id, projectId: request.projectId })),
        };
      });
    }

    if (request.kind === "truck") {
      return vehicles.filter((v) => v.vehicleType === "truck" && match(`${v.unit} ${v.makeModel ?? ""}`)).map((v) => ({
        key: v.id,
        title: `${v.unit}${v.makeModel ? ` · ${v.makeModel}` : ""}`,
        meta: v.foremanEmployeeId
          ? v.foremanEmployeeId === request.foremanId
            ? "Their truck"
            : `With ${v.foremanName} — assigning moves it`
          : "In the yard, free",
        selected: v.foremanEmployeeId === request.foremanId,
        onSelect: () =>
          run(() =>
            setCustodian.mutateAsync({
              locationId: v.locationId,
              custodianEmployeeId: v.foremanEmployeeId === request.foremanId ? null : request.foremanId,
              moveContents: true,
            }),
          ),
      }));
    }

    if (request.kind === "trailer") {
      return vehicles.filter((v) => v.vehicleType === "trailer" && match(`${v.unit} ${v.makeModel ?? ""}`)).map((v) => ({
        key: v.id,
        title: `${v.unit}${v.makeModel ? ` · ${v.makeModel}` : ""}`,
        meta: v.attachedToVehicleId
          ? v.attachedToVehicleId === request.truckId
            ? "Hitched here"
            : `Hitched to ${v.attachedToUnit} — assigning re-hitches it`
          : "Unhitched, in the yard",
        selected: v.attachedToVehicleId === request.truckId,
        onSelect: () =>
          run(() =>
            updateVehicle.mutateAsync({
              id: v.id,
              attachedToVehicleId: v.attachedToVehicleId === request.truckId ? null : request.truckId ?? null,
            }),
          ),
      }));
    }

    /* move */
    const truck = truckOf(request.foremanId);
    return projects.filter((p) => match(`${p.name} ${p.externalId ?? ""}`)).map((p) => ({
      key: p.id,
      title: p.name,
      meta: p.externalId ?? "",
      selected: truck?.projectId === p.id,
      disabled: !truck,
      onSelect: () => truck && run(() => updateVehicle.mutateAsync({ id: truck.id, projectId: p.id })),
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
  );
}
