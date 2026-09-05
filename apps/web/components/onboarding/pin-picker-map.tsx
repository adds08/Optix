"use client";

import { useCallback, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
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
*/

/* Leaflet's default marker icon references image files by a relative path
   baked into the library's own CSS, which next/webpack's asset pipeline does
   not resolve the same way — the pin renders as a broken image unless the
   icon is rebuilt from URLs Next has actually processed. Static imports
   rather than a CDN: the files are already in the workspace (leaflet is a
   real dependency, hoisted to the root by pnpm), so there is no reason to add
   a runtime fetch to a third party for three small PNGs the app already owns. */
const pinIcon = new L.Icon({
  iconUrl: markerIconUrl.src,
  iconRetinaUrl: markerIconRetinaUrl.src,
  shadowUrl: markerShadowUrl.src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const DEFAULT_CENTER: [number, number] = [32.7767, -96.797];
const DEFAULT_ZOOM = 11;
const PIN_ZOOM = 15;
/* A yard, roughly — small enough to mean something on a job site, large
   enough to drag without the handle vanishing under the cursor. */
const DEFAULT_RADIUS_M = 150;

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
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
  onChange: (next: { lat: number; lng: number; radiusM: number }) => void;
  className?: string;
}) {
  const center = useMemo<[number, number]>(
    () => (lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER),
    [lat, lng],
  );

  const dragging = useRef(false);

  /* Dragging the circle's own edge resizes it. Leaflet's Circle has no
     built-in resize handle, so this reads the pointer's distance from the
     centre on move — the same trick every hand-rolled Leaflet radius editor
     uses, and it needs no extra dependency. */
  const handleCircleMouseDown = useCallback(() => {
    dragging.current = true;
  }, []);

  const place = useCallback(
    (nlat: number, nlng: number) => {
      onChange({ lat: nlat, lng: nlng, radiusM: radiusM ?? DEFAULT_RADIUS_M });
    },
    [onChange, radiusM],
  );

  return (
    <div className={cn("relative z-0 isolate overflow-hidden rounded-md border bg-muted", className)}>
      <MapContainer center={center} zoom={lat != null ? PIN_ZOOM : DEFAULT_ZOOM} className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToPlace onPlace={place} />
        {lat != null && lng != null && (
          <>
            <Marker
              position={[lat, lng]}
              icon={pinIcon}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const m = e.target as L.Marker;
                  const p = m.getLatLng();
                  place(p.lat, p.lng);
                },
              }}
            />
            <Circle
              center={[lat, lng]}
              radius={radiusM ?? DEFAULT_RADIUS_M}
              pathOptions={{ color: "var(--primary)", fillOpacity: 0.08 }}
              eventHandlers={{
                mousedown: handleCircleMouseDown,
                /* Leaflet vector layers don't expose a resize handle, so this
                   is the whole editor: press on the circle, then any mousemove
                   over the map recomputes the radius from the cursor's
                   distance to the centre, until mouseup. */
                mousemove: (e) => {
                  if (!dragging.current) return;
                  const centerLatLng = L.latLng(lat, lng);
                  const meters = Math.round(centerLatLng.distanceTo(e.latlng));
                  onChange({ lat, lng, radiusM: Math.max(10, Math.min(20000, meters)) });
                },
                mouseup: () => {
                  dragging.current = false;
                },
              }}
            />
          </>
        )}
      </MapContainer>
    </div>
  );
}
