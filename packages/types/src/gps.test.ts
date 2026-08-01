import { describe, expect, it } from "vitest";
import { VEHICLE_ONLINE_WINDOW_MINUTES, vehicleStatus } from "./gps.js";

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
