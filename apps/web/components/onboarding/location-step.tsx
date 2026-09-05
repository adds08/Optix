"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Crosshair, MapPin } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchSelect } from "@/components/ui/search-select";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";
import { cn } from "@/lib/utils";

/* Leaflet needs the browser — same `ssr: false` pattern as `MapPage`'s
   `VehicleMap`, and for the same reason: it reaches `window` at import time. */
const PinPickerMap = dynamic(() => import("@/components/onboarding/pin-picker-map").then((m) => m.PinPickerMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[360px] w-full rounded-md" />,
});

/*
  Step three: put the claimed jobs on the map.

  Skippable, and skipped is a normal end state — see the plan. Nothing here
  requires a pin to move on; the footer's Continue is never gated on it.
*/
export function LocationStep() {
  const utils = trpc.useUtils();
  const claimed = trpc.onboarding.myClaimedProjects.useQuery();
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!projectId && claimed.data && claimed.data.length > 0) {
      /* Land on the first job still missing a pin, not simply the first job —
         a person with three jobs and one unpinned should not have to click
         past two already-done ones to find the thing this step is for. */
      const first = claimed.data.find((p) => p.missingLocation) ?? claimed.data[0];
      setProjectId(first!.id);
    }
  }, [claimed.data, projectId]);

  const current = claimed.data?.find((p) => p.id === projectId);

  const setLocation = trpc.onboarding.setLocation.useMutation({
    onSuccess: () => utils.onboarding.myClaimedProjects.invalidate(),
    onError: (e) => setError(e.message),
  });

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError("This browser has no location support.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        if (!projectId) return;
        setLocation.mutate({
          projectId,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          geofenceRadiusM: current?.geofenceRadiusM ?? 150,
        });
      },
      () => {
        setLocating(false);
        setError("Could not read your location — check the browser's permission for this site.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium">Put it on the map.</h2>
        <p className="text-xs text-muted-foreground">
          Search, drop a pin, or use your location if you're standing on the site. This step is
          optional — skip it if you'd rather not.
        </p>
      </div>

      {error && <ErrorNote message={error} />}
      {claimed.isLoading && <TableSkeleton />}

      {claimed.data && claimed.data.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          You haven't claimed a job yet — go back a step to pick one.
        </p>
      )}

      {claimed.data && claimed.data.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchSelect
              value={projectId}
              onChange={setProjectId}
              placeholder="Choose a job"
              widthClass="w-64"
              options={claimed.data.map((p) => ({
                value: p.id,
                label: `${p.externalId ? `${p.externalId} · ` : ""}${p.name}`,
                hint: p.missingLocation ? "no pin yet" : "pinned",
              }))}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!projectId || locating}
              onClick={useMyLocation}
            >
              <Crosshair className="mr-1.5 size-4" />
              {locating ? "Locating…" : "Use my location"}
            </Button>
            {current?.siteAddress && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3" aria-hidden />
                {current.siteAddress}
              </span>
            )}
          </div>

          {current && (
            <PinPickerMap
              className="h-[360px] w-full"
              lat={current.latitude != null ? Number(current.latitude) : null}
              lng={current.longitude != null ? Number(current.longitude) : null}
              radiusM={current.geofenceRadiusM}
              onChange={({ lat, lng, radiusM }) =>
                setLocation.mutate({ projectId: current.id, latitude: lat, longitude: lng, geofenceRadiusM: radiusM })
              }
            />
          )}

          <p className={cn("text-xs text-muted-foreground", setLocation.isPending && "opacity-70")}>
            Click the map to drop a pin, drag it to adjust, or drag the circle's edge to resize the
            radius. Saved automatically.
          </p>
        </>
      )}
    </section>
  );
}
