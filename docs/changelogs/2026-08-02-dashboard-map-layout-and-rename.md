# Dashboard restructured 60/40 with the fleet map, and the map renamed

Follow-up to `2026-08-01-vehicle-gps-tracking-map.md` — same feature, layout
and naming iteration from field feedback.

## What changed

- **The dashboard top row is now 60/40.** The "Needs a person" work queue sits
  on the left (60%, four cards in a 2x2 grid), and the fleet map on the right
  (40%) — the two things the desk actually looks at, side by side, instead of
  the map buried a nav level deep. The map panel links through to the full page
  ("Open full map").
- **The map page and nav item are renamed "Fleet & Small Tools Map".** The map
  is the fleet — trucks and trailers — with the small tools aboard them, so the
  name says what it covers instead of implying it is a vehicle tracker.
- **The /map page lost its description and footnote.** The page title now
  carries the whole message; the "trucks and trailers only" footnote and the
  header paragraph were noise against a map that speaks for itself.

## Found while doing it

- The sidebar truncates nav labels with an ellipsis at ~200px of text width;
  "Fleet & Small Tools Map" fits within the 248px rail, but anything longer
  would silently cut off — the label was sized to the rail.
- The map component was already shared between the page and the dashboard
  (FleetMapView), so the restructure was pure layout: moving the section up and
  changing the attention cards from 4-across to 2-across so they hold their
  shape in the 60% column.

## Not done

- The metric tiles ("Fleet at a glance") and the audit feed stay full-width
  below the 60/40 row — the user asked for cards and map at the top, not a
  wholesale redesign of the lower dashboard.
