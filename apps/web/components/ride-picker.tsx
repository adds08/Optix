"use client";

import { trpc } from "@/lib/trpc";
import { EntityField } from "@/components/ui/entity-picker";

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
        <EntityField
          value={truckId}
          onChange={onTruck}
          placeholder="None recorded"
          searchPlaceholder="Unit number or plate"
          emptyLabel="No truck matches."
          options={trucks.map((v) => ({ value: v.id, label: label(v) }))}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Trailer</label>
        <EntityField
          value={trailerId}
          onChange={onTrailer}
          placeholder="None recorded"
          searchPlaceholder="Unit number or plate"
          emptyLabel="No trailer matches."
          options={trailers.map((v) => ({ value: v.id, label: label(v) }))}
        />
      </div>
      <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
        The rig this move rides in — recorded on the hand-off itself. Left blank means no
        vehicle, not &ldquo;whatever the recipient drives&rdquo;.
      </p>
    </div>
  );
}
