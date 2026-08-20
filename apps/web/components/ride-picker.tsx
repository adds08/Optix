"use client";

import { trpc } from "@/lib/trpc";

/*
  The rig a tool rides out in, for the custody forms (STI-203).

  NOT rig-picker.tsx, despite the near-identical name. That dialog changes who
  HOLDS a vehicle and what it is hitched to (location.setCustodian,
  vehicle.update { attachedToVehicleId }); this control records a
  per-assignment historical fact — which truck and trailer the tool rode in
  when its custody moved (assignment.truckId/trailerId). Same words, different
  model: conflating them would put vehicle-hitching state into the custody
  ledger.

  Two rules, both deliberate:

  - NO default, ever. The project defaults to the recipient's primary job
    because tools follow the person (projectForCustodian) — there is no
    equivalent for vehicles, because a tool does not inherit the truck of
    whoever receives it. If a default feels natural here, the form is wrong,
    not the rule.
  - Each slot lists only its own type. The composite FK behind these columns
    rejects a trailer in the truck slot with a raw Postgres error, and the
    router's assertVehicleContext turns that into a readable refusal — but the
    honest UI never offers the mistake in the first place.
*/
const SELECT_CLS =
  "flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function RidePicker({
  truckId,
  trailerId,
  onTruck,
  onTrailer,
}: {
  truckId: string;
  trailerId: string;
  onTruck: (id: string) => void;
  onTrailer: (id: string) => void;
}) {
  const vehicles = trpc.vehicle.list.useQuery();
  const trucks = vehicles.data?.filter((v) => v.vehicleType === "truck") ?? [];
  const trailers = vehicles.data?.filter((v) => v.vehicleType === "trailer") ?? [];

  const label = (v: { unit: string; makeModel: string | null; foremanName: string | null }) =>
    `${v.unit}${v.makeModel ? ` — ${v.makeModel}` : ""}${v.foremanName ? ` · ${v.foremanName}` : ""}`;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        <label className="text-sm font-medium">Truck</label>
        <select value={truckId} onChange={(e) => onTruck(e.target.value)} className={SELECT_CLS}>
          <option value="">None recorded</option>
          {trucks.map((v) => (
            <option key={v.id} value={v.id}>{label(v)}</option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Trailer</label>
        <select value={trailerId} onChange={(e) => onTrailer(e.target.value)} className={SELECT_CLS}>
          <option value="">None recorded</option>
          {trailers.map((v) => (
            <option key={v.id} value={v.id}>{label(v)}</option>
          ))}
        </select>
      </div>
      <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
        The rig this move rides in — recorded on the hand-off itself. Left blank means no
        vehicle, not &ldquo;whatever the recipient drives&rdquo;.
      </p>
    </div>
  );
}
