import { describe, expect, it } from "vitest";
import { VEHICLE_ONLINE_WINDOW_MINUTES, groupByPosition, vehicleStatus } from "./gps.js";

/* The online/offline line. The API, the locations page and the map all read
   this one function, so a wrong threshold here shows up in all three places —
   and a test is the cheapest place to pin what "online" means. */

const NOW = new Date("2026-08-01T12:00:00Z");

describe("vehicleStatus", () => {
  it("is online when the last ping is inside the window", () => {
    const fresh = new Date(NOW.getTime() - 5 * 60_000);
    expect(vehicleStatus(fresh, NOW)).toBe("online");
  });

  it("is online right at the window edge", () => {
    const edge = new Date(NOW.getTime() - VEHICLE_ONLINE_WINDOW_MINUTES * 60_000);
    expect(vehicleStatus(edge, NOW)).toBe("online");
  });

  it("is offline once the pings stop", () => {
    const stale = new Date(NOW.getTime() - (VEHICLE_ONLINE_WINDOW_MINUTES + 1) * 60_000);
    expect(vehicleStatus(stale, NOW)).toBe("offline");
  });

  it("treats a slightly future ping as online (tracker clock skew)", () => {
    const skewed = new Date(NOW.getTime() + 30_000);
    expect(vehicleStatus(skewed, NOW)).toBe("online");
  });

  it("is no_signal when nothing was ever reported", () => {
    expect(vehicleStatus(null, NOW)).toBe("no_signal");
    expect(vehicleStatus(undefined, NOW)).toBe("no_signal");
  });

  it("accepts an ISO string the way the API passes it", () => {
    const fresh = new Date(NOW.getTime() - 60_000).toISOString();
    expect(vehicleStatus(fresh, NOW)).toBe("online");
  });

  it("is no_signal for a timestamp that cannot be parsed", () => {
    expect(vehicleStatus("not-a-date", NOW)).toBe("no_signal");
  });

  it("honours a custom window", () => {
    const tenMin = new Date(NOW.getTime() - 10 * 60_000);
    expect(vehicleStatus(tenMin, NOW, 5)).toBe("offline");
    expect(vehicleStatus(tenMin, NOW, 15)).toBe("online");
  });
});

/* UI-67. The map drew one dot per vehicle, so vehicles whose dots landed on the
   same spot drew on top of one another and only the topmost could be clicked —
   7 vehicles listed as tracked, 2 markers on screen. These pin the grouping the
   map now draws from: no vehicle with a fix may be absent from the output, and
   vehicles whose dots would overlap may not become separate markers.

   Grouping used to key on the raw coordinate string. That passed against the
   local seed, which parks 30 of 31 vehicles on one hardcoded point, and failed
   completely on the deployed fleet, where no two rows share a coordinate and the
   nearest pairs sit 0.0001° — about 11 metres — apart. Every group held one
   vehicle and the piles came back. So the question is now asked in SCREEN space
   at a given zoom, and these tests are written in those terms. */

const at = (unit: string, gpsLat: string | null, gpsLng: string | null) => ({ unit, gpsLat, gpsLng });

const YARD = { lat: "32.776600", lng: "-96.797000" };
/* The zoom the fleet map opens at, and the one the bug was reported against. */
const CITY_ZOOM = 11;

describe("groupByPosition", () => {
  it("collapses vehicles sharing a position into one group", () => {
    const groups = groupByPosition(
      [
        at("TRA-001", YARD.lat, YARD.lng),
        at("TRA-002", YARD.lat, YARD.lng),
        at("TRA-003", "32.900000", "-96.500000"),
      ],
      CITY_ZOOM,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]!.vehicles.map((v) => v.unit)).toEqual(["TRA-001", "TRA-002"]);
    expect(groups[1]!.vehicles.map((v) => v.unit)).toEqual(["TRA-003"]);
  });

  it("carries the position through as numbers the map can use", () => {
    const [group] = groupByPosition([at("TRA-001", YARD.lat, YARD.lng)], CITY_ZOOM);
    expect(group!.lat).toBe(32.7766);
    expect(group!.lng).toBe(-96.797);
  });

  it("keeps first-appearance order so markers do not reshuffle between renders", () => {
    const groups = groupByPosition(
      [
        at("TRA-009", "32.900000", "-96.500000"),
        at("TRA-001", YARD.lat, YARD.lng),
        at("TRA-002", YARD.lat, YARD.lng),
      ],
      CITY_ZOOM,
    );
    expect(groups.map((g) => g.lat)).toEqual([32.9, 32.7766]);
  });

  it("puts a vehicle with no fix in no group at all", () => {
    const groups = groupByPosition(
      [
        at("TRA-001", YARD.lat, YARD.lng),
        at("TRA-004", null, "-96.797000"),
        at("TRA-005", YARD.lat, null),
        at("TRA-006", null, null),
      ],
      CITY_ZOOM,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.vehicles.map((v) => v.unit)).toEqual(["TRA-001"]);
  });

  it("returns nothing for an empty fleet", () => {
    expect(groupByPosition([], CITY_ZOOM)).toEqual([]);
  });

  /* THE REGRESSION. This is the deployed fleet's exact shape, and the case the
     previous implementation got wrong: coordinates that differ, but by so little
     that the dots are indistinguishable. It asserted two groups and shipped the
     bug back. */
  it("groups pings that differ only in the last decimal — 11m is one dot at city zoom", () => {
    const groups = groupByPosition(
      [at("TRA-001", YARD.lat, YARD.lng), at("TRA-002", YARD.lat, "-96.797100")],
      CITY_ZOOM,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.vehicles.map((v) => v.unit)).toEqual(["TRA-001", "TRA-002"]);
  });

  it("separates those same pings once you zoom in far enough to tell them apart", () => {
    const rows = [at("TRA-001", YARD.lat, YARD.lng), at("TRA-002", YARD.lat, "-96.797100")];
    expect(groupByPosition(rows, 19)).toHaveLength(2);
  });

  it("keeps genuinely distant vehicles apart even at low zoom", () => {
    /* Dallas and Houston — the deployed fleet spans both, and no zoom the map
       offers should merge them. */
    const groups = groupByPosition(
      [at("TRA-001", YARD.lat, YARD.lng), at("TRU-004", "29.760400", "-95.369800")],
      CITY_ZOOM,
    );
    expect(groups).toHaveLength(2);
  });

  it("anchors a group on a real reported position, never an average", () => {
    /* A marker must never sit where no tracker said a vehicle was. The group
       takes the FIRST member's coordinates verbatim. */
    const groups = groupByPosition(
      [at("TRA-001", YARD.lat, YARD.lng), at("TRA-002", "32.776700", "-96.797100")],
      CITY_ZOOM,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.lat).toBe(32.7766);
    expect(groups[0]!.lng).toBe(-96.797);
  });

  it("loses no vehicle: every fix lands in exactly one group", () => {
    /* The invariant the bug violated, in the reported shape — 7 tracked
       vehicles that must all remain reachable, whatever the grouping. */
    const fleet = [
      at("TRU-001", YARD.lat, YARD.lng),
      at("TRU-002", "32.780000", "-96.805000"),
      at("TRA-002", "32.780000", "-96.805100"),
      at("TRU-003", "29.760400", "-95.369800"),
      at("TRU-004", "32.850000", "-96.850000"),
      at("TRA-001", YARD.lat, "-96.797100"),
      at("TRA-003", "29.760400", "-95.369900"),
    ];
    const groups = groupByPosition(fleet, CITY_ZOOM);

    const placed = groups.flatMap((g) => g.vehicles);
    expect(placed).toHaveLength(fleet.length);
    expect(new Set(placed.map((v) => v.unit)).size).toBe(fleet.length);
    for (const v of fleet) {
      expect(groups.filter((g) => g.vehicles.includes(v))).toHaveLength(1);
    }

    /* And it must actually COLLAPSE them: 7 vehicles over 3 visual piles. A
       result of 7 groups is the bug, and is what shipped. */
    expect(groups.length).toBeLessThan(fleet.length);
  });
});
