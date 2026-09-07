"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Crosshair, MapPin } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchSelect } from "@/components/ui/search-select";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";
import { useStepReady } from "@/components/onboarding/step-shell";
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

  EVERY JOB HERE IS EDITABLE, and that is now true by construction rather than
  by checking. This step used to list claimed jobs too — a step-one tick that
  granted nothing — so some rows accepted a pin and some answered 403, and the
  step had to explain the difference. Claims are gone: `myClaimedProjects`
  reads the roster, which is the same set `setLocation` enforces, so there is
  no longer a job on this list the server can refuse.

  The read-only branch is KEPT anyway, guarded on `onRoster`. It costs a
  boolean and it is the difference between a future step surfacing a job
  somebody is not on and that step silently 403ing again.

  The map is FULL-BLEED, not a 360px box floating in padding. It was the
  latter, and a map is the one control on this screen that is strictly better
  the bigger it is — a pin dropped on a bigger map is a more accurate pin. The
  job picker and the location button ride ON the map as overlays rather than
  taking a row above it, which is how every map tool the crew already uses
  behaves.
*/
export function LocationStep() {
  const utils = trpc.useUtils();
  const claimed = trpc.onboarding.myClaimedProjects.useQuery();
  /* See the long comment on `StepShell`: Leaflet measures its own container on
     mount and cannot tolerate that container's ancestor still being mid-way
     through the enter transform. The real map waits for the step's entrance
     to settle; the skeleton fills the gap so nothing visibly pops in late. */
  const stepReady = useStepReady();
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!projectId && claimed.data && claimed.data.length > 0) {
      /* Land on the first job this person can actually DO something about:
         theirs, and still missing a pin. Falling back through "theirs" before
         "anything" matters — opening on a read-only job would show a person
         the one state of this step where nothing can be done, and read as the
         step being broken. */
      const first =
        claimed.data.find((p) => p.onRoster && p.missingLocation) ??
        claimed.data.find((p) => p.onRoster) ??
        claimed.data[0];
      setProjectId(first!.id);
    }
  }, [claimed.data, projectId]);

  const current = claimed.data?.find((p) => p.id === projectId);
  /* The whole step keys off this: a claim is not authority, and `setLocation`
     enforces that on the server. See the file comment. */
  const canEdit = !!current?.onRoster;

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
      {error && <ErrorNote message={error} />}
      {claimed.isLoading && <TableSkeleton />}

      {claimed.data && claimed.data.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          You're not on any jobs yet, so there's nothing to set here.
        </p>
      )}

      {claimed.data && claimed.data.length > 0 && (
        <>
          {/* The map fills the step and the controls sit on it. `h-[26rem]`
              rather than a viewport unit: the step already scrolls inside a
              fixed shell, so a vh-sized map would fight that box rather than
              fill it. */}
          <div className="relative h-[26rem] w-full overflow-hidden rounded-lg border">
            {current && !stepReady && <Skeleton className="size-full" />}
            {current && stepReady && (
              <PinPickerMap
                className="size-full"
                lat={current.latitude != null ? Number(current.latitude) : null}
                lng={current.longitude != null ? Number(current.longitude) : null}
                radiusM={current.geofenceRadiusM}
                /* No handler when the job is not the caller's: `PinPickerMap`
                   reads this as "read-only" and stops binding click and drag,
                   so the map cannot even attempt a write that would 403. */
                onChange={
                  canEdit
                    ? ({ lat, lng, radiusM }) =>
                        setLocation.mutate({
                          projectId: current.id,
                          latitude: lat,
                          longitude: lng,
                          geofenceRadiusM: radiusM,
                        })
                    : undefined
                }
              />
            )}

            {/* Overlaid, and `z-[500]` because Leaflet's own panes stack to
                z-700 inside the container — anything meant to sit above the
                tiles has to clear them. Leaflet's zoom buttons are top-left,
                so this bar starts from the right of that. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex flex-wrap items-center justify-end gap-2 p-3">
              {/* `bg-background` rather than the picker's own transparent
                  trigger: over map tiles a see-through control stops reading
                  as a control at all, and the street names run straight
                  through the job name. */}
              <div className="pointer-events-auto rounded-md bg-background shadow-sm">
                <SearchSelect
                  value={projectId}
                  onChange={setProjectId}
                  placeholder="Choose a job"
                  widthClass="w-60"
                  options={claimed.data.map((p) => ({
                    value: p.id,
                    label: `${p.externalId ? `${p.externalId} · ` : ""}${p.name}`,
                    hint: !p.onRoster ? "not yours to set" : p.missingLocation ? "no pin yet" : "pinned",
                  }))}
                />
              </div>

              {canEdit && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="pointer-events-auto shadow-sm"
                  disabled={locating}
                  onClick={useMyLocation}
                >
                  <Crosshair className="mr-1.5 size-4" />
                  {locating ? "Locating…" : "Use my location"}
                </Button>
              )}

              {/* Saving is invisible on a map that already moved, so it is
                  said here rather than left to the caption below. */}
              {setLocation.isPending && (
                <span className="pointer-events-none rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
                  Saving…
                </span>
              )}
            </div>

            {current?.siteAddress && (
              <span className="pointer-events-none absolute bottom-3 left-3 z-[500] flex max-w-[60%] items-center gap-1.5 truncate rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
                <MapPin className="size-3 shrink-0" aria-hidden />
                {current.siteAddress}
              </span>
            )}
          </div>

          {/* One line, and which line depends on whether the person can act.
              Telling somebody to "click the map to drop a pin" on a map that
              will refuse them is the same defect as the 403 itself. */}
          <p className={cn("text-xs", canEdit ? "text-muted-foreground" : "text-warn")}>
            {canEdit
              ? "Click the map to drop a pin, drag it to adjust, or drag the circle's edge to resize the radius. Saved automatically."
              : "You told us you work on this job, but you're not on its crew list yet — so its pin isn't yours to set. Whoever runs the job can drop it, or it can wait until they add you."}
          </p>
        </>
      )}
    </section>
  );
}
