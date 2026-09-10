"use client";

import { useEffect, useMemo, useRef } from "react";
import { Circle, MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { cn } from "@/lib/utils";

/*
  Drop a pin, drag a radius. The onboarding map step's control.

  A DIFFERENT job from `FleetMapView`: that one draws where vehicles already
  are and is read-mostly. This one is an editor — click to place, drag the
  circle's edge to size it — so it is its own component rather than a mode
  bolted onto the fleet view.

  Same tile source and the same `relative z-0 isolate` stacking fix as
  `fleet-map-view.tsx` (docs/20, A4): Leaflet's internal panes stack up to
  z-700 and escape an ancestor with no stacking context of its own.

  THE BUG THIS FILE'S SHAPE EXISTS TO AVOID, found live in a browser rather
  than guessed at: an earlier version called `onChange` on every `mousemove`
  while dragging the circle's edge. That re-rendered the parent, which passed
  a new `radius` prop back down, and react-leaflet's response to a changed
  `radius` is to call the underlying Leaflet layer's `setRadius` — done
  SYNCHRONOUSLY, from inside a callback Leaflet itself was still dispatching
  for that same mouse event. The reentrant mutation corrupted Leaflet's
  internal event bookkeeping and crashed the whole map with "Cannot read
  properties of undefined (reading '_leaflet_events')", reproducible on the
  first drag every time.

  The fix is to keep the whole drag OUTSIDE React state. `RadiusEditor` below
  mutates the Leaflet circle instance directly (`circle.setRadius(...)`, which
  is what Leaflet itself is built to do many times a second) and calls
  `onChange` exactly once, on mouseup, which is the only moment a React
  re-render is actually wanted.
*/

/*
  Leaflet's default marker icon references image files by a relative path
  baked into the library's own bundled CSS, which does not survive Next's own
  build — the marker silently fails to construct ("iconUrl not set in Icon
  options") and Leaflet's cleanup path then crashes trying to remove an icon
  that was never created ("Cannot read properties of undefined
  (reading '_leaflet_events')"), which is what actually took the whole map
  down on every mount, reproducible every time.

  A static `import` of the PNGs was tried first and hit the same failure: a
  dynamically-imported client component (this one, loaded through
  `next/dynamic` with `ssr:false` in `location-step.tsx`) does not necessarily
  resolve a bundler asset import to the `{ src }` object plain code expects,
  and there is no reliable way to tell from here whether the value it produced
  was ever going to be right.

  The fix that cannot have this failure mode: the three PNGs are copied into
  `public/leaflet/` (see that directory's contents) and referenced by a plain
  absolute path, exactly like any other static asset in `public/`. No bundler
  resolution involved, so there is nothing left to resolve incorrectly.
*/
const pinIcon = new L.Icon({
  iconUrl: "/leaflet/marker-icon.png",
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  shadowUrl: "/leaflet/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const DEFAULT_CENTER: [number, number] = [32.7767, -96.797];
const DEFAULT_ZOOM = 11;
const PIN_ZOOM = 15;
/* A yard, roughly — small enough to mean something on a job site, large
   enough to drag without the handle vanishing under the cursor. */
const DEFAULT_RADIUS_M = 150;
const MIN_RADIUS_M = 10;
const MAX_RADIUS_M = 20000;

/*
  Follow the selected job.

  `MapContainer`'s `center` and `zoom` are INITIAL values — Leaflet reads them
  once on mount and ignores every later change, which is a documented
  react-leaflet behaviour and an easy one to mistake for a broken map. Picking
  a second job from the overlay left the view sitting on the first one's
  coordinates, so a pinned job looked unpinned and an unpinned one looked
  wrongly placed. Moving the view is therefore an imperative call.

  `animate: false` because this is a jump between two unrelated places, not a
  pan across one map — flying between two Dallas suburbs is motion that says
  nothing and delays the answer.
*/
function RecenterOn({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: false });
  }, [map, center[0], center[1], zoom]);
  return null;
}

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/*
  Renders the circle and owns its own drag-to-resize, entirely imperatively.

  Mounted fresh whenever `center` changes (keyed by the caller), so it never
  has to reconcile a moved pin against an in-progress drag — a new pin is a
  new editor.
*/
function RadiusEditor({
  center,
  radiusM,
  onCommit,
}: {
  center: [number, number];
  radiusM: number;
  onCommit: (radiusM: number) => void;
}) {
  const map = useMap();
  const circleRef = useRef<L.Circle | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const circle = L.circle(center, {
      radius: radiusM,
      color: "var(--primary)",
      fillOpacity: 0.08,
    }).addTo(map);
    circleRef.current = circle;

    const onDown = () => {
      draggingRef.current = true;
      map.dragging.disable();
    };
    const onMove = (e: L.LeafletMouseEvent) => {
      if (!draggingRef.current) return;
      const meters = Math.round(L.latLng(center).distanceTo(e.latlng));
      circle.setRadius(Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, meters)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      map.dragging.enable();
      onCommit(circle.getRadius());
    };

    circle.on("mousedown", onDown);
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);

    return () => {
      circle.off("mousedown", onDown);
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      circle.remove();
    };
    /* Deliberately keyed on the map instance and the coordinates only, never
       on `radiusM`: re-running this effect every time the radius changes
       during a drag is exactly the reentrancy this component exists to avoid.
       `radiusM` seeds the circle once on mount and is otherwise owned by the
       imperative `setRadius` calls above. */
  }, [map, center[0], center[1], onCommit]);

  return null;
}

export function PinPickerMap({
  lat,
  lng,
  radiusM,
  onChange,
  className,
}: {
  lat: number | null;
  lng: number | null;
  radiusM: number | null;
  /*
    OMITTED MEANS READ-ONLY, and it is a real state rather than a convenience:
    `setLocation` requires a live roster row, so a job the person only claimed
    on step one can be looked at here and not edited. Without this the map
    accepted clicks and the server answered 403 — see `location-step.tsx`.

    Read-only removes the click and drag bindings rather than merely ignoring
    their results, so nothing on the map invites an action that cannot land.
  */
  onChange?: (next: { lat: number; lng: number; radiusM: number }) => void;
  className?: string;
}) {
  const center = useMemo<[number, number]>(
    () => (lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER),
    [lat, lng],
  );

  const editable = !!onChange;

  const place = (nlat: number, nlng: number) => {
    onChange?.({ lat: nlat, lng: nlng, radiusM: radiusM ?? DEFAULT_RADIUS_M });
  };

  return (
    <div className={cn("relative z-0 isolate overflow-hidden rounded-md border bg-muted", className)}>
      <MapContainer center={center} zoom={lat != null ? PIN_ZOOM : DEFAULT_ZOOM} className="h-full w-full">
        {/*
          The TILES are toned to the palette, the markers and the radius are
          not — that is what `sti-map-tiles` scopes the filter to.

          OpenStreetMap's raster tiles are a bright daylight map, and this
          screen is the product's first impression: navy and near-black
          everywhere except, before this, one glaring white rectangle in the
          middle of it. Inverting and re-rotating the hue is the standard way
          to darken raster tiles without hosting a second tile set, and it
          costs nothing at runtime.

          Applied HERE and deliberately not to `fleet-map-view.tsx`, which has
          the same brightness problem: that map is a working surface people
          already know, and changing how the whole fleet reads is its own
          decision to take deliberately rather than as a side effect of
          building an onboarding screen.
        */}
        <TileLayer
          className="sti-map-tiles"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <RecenterOn center={center} zoom={lat != null ? PIN_ZOOM : DEFAULT_ZOOM} />
        {editable && <ClickToPlace onPlace={place} />}
        {lat != null && lng != null && (
          <>
            <Marker
              position={[lat, lng]}
              icon={pinIcon}
              draggable={editable}
              eventHandlers={{
                dragend: (e) => {
                  const m = e.target as L.Marker;
                  const p = m.getLatLng();
                  place(p.lat, p.lng);
                },
              }}
            />
            {/* A read-only job still SHOWS its radius — the fact is worth
                seeing — but through a plain circle rather than the editor,
                which binds the drag handlers. */}
            {editable ? (
              <RadiusEditor
                key={`${lat},${lng}`}
                center={[lat, lng]}
                radiusM={radiusM ?? DEFAULT_RADIUS_M}
                onCommit={(nextRadius) => onChange?.({ lat, lng, radiusM: nextRadius })}
              />
            ) : (
              <Circle
                center={[lat, lng]}
                radius={radiusM ?? DEFAULT_RADIUS_M}
                pathOptions={{ color: "var(--muted-foreground)", fillOpacity: 0.06 }}
              />
            )}
          </>
        )}
      </MapContainer>
    </div>
  );
}
