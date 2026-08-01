"use client";

import dynamic from "next/dynamic";
import { PageHeader } from "@/components/sti/page";
import { Skeleton } from "@/components/ui/skeleton";

/*
  The fleet at a glance.

  Leaflet needs the browser — it touches the DOM the moment it is imported, so
  the map is loaded client-side only. The page itself can stay a plain client
  component; the data comes from the same vehicle.list the Locations page uses,
  which already computes online/offline.
*/
const VehicleMap = dynamic(() => import("@/components/vehicle-map").then((m) => m.VehicleMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[70vh] w-full rounded-md" />,
});

export default function MapPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Equipment"
        title="Fleet map"
        description="Where the trucks and trailers are, and whether they are still reporting. Tools aboard a vehicle are wherever the vehicle is."
      />
      <VehicleMap />
    </div>
  );
}
