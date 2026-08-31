"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { rigOf } from "@/lib/rig";
import { cn } from "@/lib/utils";

/*
  Everything you can hang on a crew, behind one searchable dialog.

  Each branch maps onto an existing procedure — none of this needs new API:

    truck    location.setCustodian { locationId: truck.locationId, custodianEmployeeId }
             (the hitched trailer and every tool aboard follow — see location.ts)
    trailer  with a truck:  vehicle.update { attachedToVehicleId }
             without one:   the trailer is given DIRECTLY to the foreman —
                            location.setCustodian on the trailer (and it is
                            unhitched first if it rode another truck). A trailer
                            does not need a truck to belong to a crew.
    crew     projectTeam.assign { projectId, employeeId, role: "foreman" }
    move     same call with the new projectId

  The crew and move branches route through projectTeam.assign — the same move
  employee.assignToProject performs — so a foreman added to a job is actually
  POSTED there: their posting and primary project change, the roster row keeps
  in lockstep, and the truck, the hitched trailer and every tool aboard move
  together.

  Every row action is confirmed before it runs — assigning, detaching, re-
  hitching, taking over or moving all stop at the same dialog, because a
  custody move is not the kind of thing a stray click should commit.

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
  /* Every picker action stops here first. The copy states what will actually
     happen — assigning, detaching, re-hitching, taking over or moving — and
     the desk commits it out loud instead of by stray click. */
  /*
    `option` is the confirm dialog's one optional checkbox, and `run` receives
    its state. Added for "move all tools with them" rather than a second dialog
    component, because every other action here already confirms through this
    one and a parallel dialog is how two confirmations drift apart in wording.
    Callers that pass no `option` ignore the argument entirely.
  */
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    action: string;
    option?: { label: string; hint: string };
    run: (optionOn: boolean) => void;
  } | null>(null);
  /* Reset to true by `ask` on every open: the default is "the tools come with
     them", and a checkbox that remembered being unticked would quietly apply a
     previous decision to an unrelated crew. */
  const [optionOn, setOptionOn] = useState(true);

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

  const ask = (
    title: string,
    body: string,
    action: string,
    run: (optionOn: boolean) => void,
    option?: { label: string; hint: string },
  ) => {
    setOptionOn(true);
    setConfirm({ title, body, action, run, option });
  };

  const foremanNameOf = (id: string) => foremen.find((f) => f.id === id)?.name ?? "this foreman";

  const rows = useMemo((): PickerRow[] => {
    if (!request) return [];
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);

    if (request.kind === "crew") {
      return foremen.filter((f) => match(`${f.externalId ?? ""} ${f.name} ${f.role}`)).map((f) => {
        const rig = rigOf(f.id, vehicles);
        const onJob = rig.truck?.projectId === request.projectId;
        const proj = projects.find((p) => p.id === request.projectId);
        return {
          key: f.id,
          title: f.externalId ? `${f.externalId} · ${f.name}` : f.name,
          meta: `${rig.truck ? rig.truck.unit : "no truck"}${rig.trailer ? ` + ${rig.trailer.unit}` : ""} · ${f.role}`,
          selected: !!onJob,
          /*
            No longer disabled without a rig.

            This used to refuse anybody holding neither truck nor trailer, on
            the reasoning that "those are what move to a job". They are what
            CARRIES tools to a job, which is a different claim: a crew is put
            on a job before it is rigged all the time — the job is awarded, the
            foreman is named, and the truck is allocated the following week.
            Refusing meant the roster could not describe the fortnight in
            between, so the desk recorded it nowhere and the job read as having
            no crew at all. The gap is still worth SAYING, which is what the
            hint does; it is not worth blocking.
          */
          hint: rig.truck || rig.trailer ? undefined : "No truck or trailer yet — they can still be put on the job.",
          onSelect: () =>
            ask(
              `Add ${f.name} to ${proj?.name ?? "this job"}?`,
              `${f.name} is posted to this project: their posting and primary project move${
                rig.truck || rig.trailer ? ", and their truck, trailer and the tools aboard follow" : ""
              }.`,
              "Add crew",
              (withTools) =>
                run(() =>
                  assignForeman.mutateAsync({
                    projectId: request.projectId,
                    employeeId: f.id,
                    /* The person's own role, not a hard-coded "foreman".
                       A superintendent holds custody since 2026-09-01, so
                       posting one as a foreman would file them under the wrong
                       team role and move somebody else's roster row. */
                    role: f.role === "superintendent" ? "superintendent" : "foreman",
                    moveTools: withTools,
                  }),
                ),
              {
                label: "Move their tools to this job",
                hint: "Unticked, the tools stay on the job they are on now with nobody holding them — the truck and trailer still travel.",
              },
            ),
        };
      });
    }

    if (request.kind === "truck") {
      return vehicles.filter((v) => v.vehicleType === "truck" && match(`${v.unit} ${v.makeModel ?? ""}`)).map((v) => {
        const theirs = v.foremanEmployeeId === request.foremanId;
        const takenFrom = !theirs && v.foremanEmployeeId ? v.foremanName : null;
        const foreman = foremanNameOf(request.foremanId);
        const apply = (custodian: string | null) =>
          run(() =>
            setCustodian.mutateAsync({
              locationId: v.locationId,
              custodianEmployeeId: custodian,
              moveContents: true,
            }),
          );
        return {
          key: v.id,
          title: `${v.unit}${v.makeModel ? ` · ${v.makeModel}` : ""}`,
          meta: theirs ? "Their truck" : takenFrom ? `With ${takenFrom} — taking it moves it` : "In the yard, free",
          selected: theirs,
          onSelect: () => {
            if (theirs) {
              /* Deassign: this is taking the truck OFF the foreman. */
              ask(
                `Detach ${v.unit} from ${foreman}?`,
                `${v.unit} is currently ${foreman}'s truck. Detaching returns it to the yard — the hitched trailer and every tool aboard come off with it.`,
                "Detach",
                () => apply(null),
              );
            } else if (takenFrom) {
              ask(
                `Take ${v.unit} from ${takenFrom}?`,
                `${v.unit} is currently with ${takenFrom}. Taking it removes it from them first — the hitched trailer and every tool aboard go to ${foreman}.`,
                "Take it over",
                () => apply(request.foremanId),
              );
            } else {
              ask(
                `Assign ${v.unit} to ${foreman}?`,
                `${foreman} becomes the holder — the hitched trailer and every tool aboard follow them.`,
                "Assign",
                () => apply(request.foremanId),
              );
            }
          },
        };
      });
    }

    if (request.kind === "trailer") {
      return vehicles.filter((v) => v.vehicleType === "trailer" && match(`${v.unit} ${v.makeModel ?? ""}`)).map((v) => {
        const here = request.truckId ? v.attachedToVehicleId === request.truckId : false;
        const rehitchFrom = !here && v.attachedToVehicleId ? v.attachedToUnit : null;
        const foreman = foremanNameOf(request.foremanId);
        /* Mirrors `takenFrom` in the truck branch above, and holds the NAME for
           the same reason: the row has to say who it would be taken from. */
        const heldByOther =
          !here && v.foremanEmployeeId && v.foremanEmployeeId !== request.foremanId
            ? v.foremanName
            : null;
        const applyHitch = (truckId: string | null) =>
          run(() => updateVehicle.mutateAsync({ id: v.id, attachedToVehicleId: truckId }));
        const applyDirect = () =>
          run(async () => {
            /* Give the trailer to the foreman directly: unhitch it from any
               truck first (a trailer cannot ride two trucks), then hand the
               trailer itself over — its tools follow. */
            if (v.attachedToVehicleId) {
              await updateVehicle.mutateAsync({ id: v.id, attachedToVehicleId: null });
            }
            await setCustodian.mutateAsync({
              locationId: v.locationId,
              custodianEmployeeId: request.foremanId,
              moveContents: true,
            });
          });

        if (!request.truckId) {
          /* No truck on this crew: the trailer is assigned straight to the
             foreman — this is the flexibility the field needs. */
          const theirTrailer = v.foremanEmployeeId === request.foremanId;
          return {
            key: v.id,
            title: `${v.unit}${v.makeModel ? ` · ${v.makeModel}` : ""}`,
            meta: theirTrailer
              ? "Their trailer"
              : rehitchFrom
                ? `Hitched to ${rehitchFrom} — giving it to ${foreman} takes it off that truck`
                : /* A trailer can be held by a foreman with no truck under it —
                     that is what `applyDirect` below exists for — and this row
                     used to call that "Unhitched, in the yard", which is only
                     half true and hides the person it would be taken from. The
                     truck branch above has always said "With X — taking it
                     moves it"; this is the same warning for the same state. */
                  heldByOther
                  ? `With ${heldByOther} — giving it to ${foreman} takes it off them`
                  : "Unhitched, in the yard",
            selected: theirTrailer,
            onSelect: () => {
              if (theirTrailer) {
                ask(
                  `Take ${v.unit} off ${foreman}?`,
                  `${v.unit} is currently ${foreman}'s trailer. Detaching returns it to the yard — the tools aboard come off with it.`,
                  "Detach",
                  () => run(() => setCustodian.mutateAsync({ locationId: v.locationId, custodianEmployeeId: null, moveContents: true })),
                );
              } else if (rehitchFrom) {
                ask(
                  `Give ${v.unit} to ${foreman}?`,
                  `${v.unit} is hitched to ${rehitchFrom}. Giving it to ${foreman} takes it off that truck first and hands it to them — the tools aboard follow.`,
                  "Give it over",
                  applyDirect,
                );
              } else if (heldByOther) {
                /* Taking a trailer off another foreman, which the row above now
                   says out loud. The truck branch has always confirmed this
                   case separately; without it the dialog read "no truck needed"
                   over an action that takes somebody's trailer away. */
                ask(
                  `Take ${v.unit} from ${heldByOther}?`,
                  `${v.unit} is currently with ${heldByOther}. Giving it to ${foreman} takes it off them first — the tools aboard go too.`,
                  "Take it over",
                  applyDirect,
                );
              } else {
                ask(
                  `Give ${v.unit} to ${foreman}?`,
                  `${foreman} becomes the holder of ${v.unit} — no truck needed, the tools aboard follow.`,
                  "Give it over",
                  applyDirect,
                );
              }
            },
          };
        }

        return {
          key: v.id,
          title: `${v.unit}${v.makeModel ? ` · ${v.makeModel}` : ""}`,
          meta: here ? "Hitched here" : rehitchFrom ? `Hitched to ${rehitchFrom} — re-hitching moves it` : "Unhitched, in the yard",
          selected: here,
          onSelect: () => {
            if (here) {
              const truck = vehicles.find((x) => x.id === request.truckId);
              ask(
                `Unhitch ${v.unit} from ${truck?.unit ?? "the truck"}?`,
                `${v.unit} comes off that truck and returns to the yard.`,
                "Unhitch",
                () => applyHitch(null),
              );
            } else if (rehitchFrom) {
              ask(
                `Re-hitch ${v.unit} from ${rehitchFrom}?`,
                `${v.unit} is currently hitched to ${rehitchFrom}. Re-hitching takes it off that truck first — if the new truck has a foreman, the trailer and its tools move to them.`,
                "Re-hitch",
                () => applyHitch(request.truckId ?? null),
              );
            } else {
              ask(
                `Hitch ${v.unit} to ${vehicles.find((x) => x.id === request.truckId)?.unit ?? "the truck"}?`,
                `${v.unit} is hitched to the truck — if it has a foreman, the trailer and its tools move to them.`,
                "Hitch",
                () => applyHitch(request.truckId ?? null),
              );
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
      disabled: !rig.truck && !rig.trailer,
      onSelect: () =>
        ask(
          `Move ${foremanNameOf(request.foremanId)} to ${p.name}?`,
          `Their posting and primary project change, and the truck, trailer and the tools aboard travel with them.`,
          "Move",
          () => run(() => assignForeman.mutateAsync({ projectId: p.id, employeeId: request.foremanId, role: "foreman" })),
        ),
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
      note: "truckId" in request && request.truckId
        ? "Hitch a trailer to this crew's truck — the small tools ride in it."
        : "A trailer can be given straight to this foreman — no truck needed. The tools aboard follow.",
      placeholder: "Search unit or model…",
    },
    move: {
      title: `Move ${foremanName} to another job`,
      note: "Their truck, trailer and the tools aboard travel with them.",
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

      {/* Every picker action confirms here first. */}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
          </DialogHeader>
          <p className="-mt-2 text-sm text-muted-foreground">{confirm?.body}</p>
          {confirm?.option ? (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border bg-muted/30 p-3">
              <Checkbox
                checked={optionOn}
                onCheckedChange={(v) => setOptionOn(v === true)}
                className="mt-0.5"
                aria-describedby="rig-confirm-option-hint"
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium leading-none">{confirm.option.label}</span>
                <span id="rig-confirm-option-hint" className="block text-xs text-muted-foreground">
                  {confirm.option.hint}
                </span>
              </span>
            </label>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              disabled={busy}
              onClick={() => {
                const c = confirm;
                const on = optionOn;
                setConfirm(null);
                c?.run(on);
              }}
            >
              {confirm?.action ?? "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
