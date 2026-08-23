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

/* UI-67. The map drew one dot per vehicle, so vehicles sharing a position drew
   on top of one another and only the topmost could be clicked — 7 vehicles
   listed as tracked, 2 markers on screen. These pin the grouping the map now
   draws from: no vehicle with a fix may be absent from the output, and two
   vehicles at one point may not become two markers. */

const at = (unit: string, gpsLat: string | null, gpsLng: string | null) => ({ unit, gpsLat, gpsLng });

const YARD = { lat: "32.776600", lng: "-96.797000" };

describe("groupByPosition", () => {
  it("collapses vehicles sharing a position into one group", () => {
    const groups = groupByPosition([
      at("TRA-001", YARD.lat, YARD.lng),
      at("TRA-002", YARD.lat, YARD.lng),
      at("TRA-003", "32.900000", "-96.500000"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.vehicles.map((v) => v.unit)).toEqual(["TRA-001", "TRA-002"]);
    expect(groups[1]!.vehicles.map((v) => v.unit)).toEqual(["TRA-003"]);
  });

  it("carries the position through as numbers the map can use", () => {
    const [group] = groupByPosition([at("TRA-001", YARD.lat, YARD.lng)]);
    expect(group!.lat).toBe(32.7766);
    expect(group!.lng).toBe(-96.797);
  });

  it("keeps first-appearance order so markers do not reshuffle between renders", () => {
    const groups = groupByPosition([
      at("TRA-009", "32.900000", "-96.500000"),
      at("TRA-001", YARD.lat, YARD.lng),
      at("TRA-002", YARD.lat, YARD.lng),
    ]);
    expect(groups.map((g) => g.lat)).toEqual([32.9, 32.7766]);
  });

  it("puts a vehicle with no fix in no group at all", () => {
    const groups = groupByPosition([
      at("TRA-001", YARD.lat, YARD.lng),
      at("TRA-004", null, "-96.797000"),
      at("TRA-005", YARD.lat, null),
      at("TRA-006", null, null),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.vehicles.map((v) => v.unit)).toEqual(["TRA-001"]);
  });

  it("returns nothing for an empty fleet", () => {
    expect(groupByPosition([])).toEqual([]);
  });

  it("does not treat positions that differ only in the last decimal as the same point", () => {
    const groups = groupByPosition([
      at("TRA-001", YARD.lat, YARD.lng),
      at("TRA-002", "32.776601", YARD.lng),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("loses no vehicle: groups equal distinct positions, and every fix lands in exactly one", () => {
    /* The invariant the bug violated. 7 tracked vehicles over 2 positions is
       the reported shape: it must produce 2 groups holding all 7, never 2
       groups holding 2. */
    const fleet = [
      at("TRA-001", YARD.lat, YARD.lng),
      at("TRA-002", YARD.lat, YARD.lng),
      at("TRA-003", "32.900000", "-96.500000"),
      at("TRA-004", YARD.lat, YARD.lng),
      at("TRA-005", YARD.lat, YARD.lng),
      at("TRA-006", "32.900000", "-96.500000"),
      at("TRA-007", YARD.lat, YARD.lng),
    ];
    const groups = groupByPosition(fleet);

    const distinct = new Set(fleet.map((v) => `${v.gpsLat},${v.gpsLng}`));
    expect(groups).toHaveLength(distinct.size);

    const placed = groups.flatMap((g) => g.vehicles);
    expect(placed).toHaveLength(fleet.length);
    expect(new Set(placed.map((v) => v.unit)).size).toBe(fleet.length);
    for (const v of fleet) {
      expect(groups.filter((g) => g.vehicles.includes(v))).toHaveLength(1);
    }
  });
});
