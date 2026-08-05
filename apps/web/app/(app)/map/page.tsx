"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/*
  The fleet at a glance — the trucks and trailers with the small tools aboard
  them. Leaflet needs the browser, so the map is loaded client-side only; the
  data comes from the same vehicle.list the Locations page uses, which already
  computes online/offline.
*/
const VehicleMap = dynamic(() => import("@/components/vehicle-map").then((m) => m.VehicleMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[70vh] w-full rounded-md" />,
});

export default function MapPage() {
  return (
    <div className="flex flex-col gap-6">
      <VehicleMap />
    </div>
  );
}
