import type { Rig } from "@/components/jobsite-crew-card";

/*
  A foreman's rig, resolved once.

  The jobsite cards and the rig picker both need "which truck does this
  foreman have, and which trailer is hitched to it". One implementation here,
  so the card can never show a rig the picker cannot find (or vice versa) —
  a second copy of the rule is how the two surfaces silently drift.
*/

export type RigVehicle = {
  id: string;
  vehicleType: string;
  unit: string;
  makeModel: string | null;
  locationId: string;
  projectId: string | null;
  foremanEmployeeId: string | null;
  attachedToVehicleId: string | null;
};

export function rigOf(foremanId: string | null | undefined, list: RigVehicle[]): Rig {
  if (!foremanId) return { truck: null, trailer: null };
  const truck = list.find((v) => v.vehicleType === "truck" && v.foremanEmployeeId === foremanId) ?? null;
  const trailer = truck
    ? list.find((v) => v.vehicleType === "trailer" && v.attachedToVehicleId === truck.id) ?? null
    : null;
  return { truck, trailer };
}
