"use client";

import { useEffect, useState } from "react";

/*
  Project monitor preferences — per DEVICE, not per account.

  These live in localStorage and never reach the database, deliberately. The
  thing they configure is a physical screen: the TV in the shop wants a slow
  crawl legible from the far wall, the laptop the equipment manager checks it on
  wants to get through the list. Those are properties of the screen, not of
  whoever happens to be signed in on it, and storing them server-side would mean
  one person's choice retunes every board in the company.

  It also means no migration, no procedure and no permission — a board can be
  tuned by whoever is standing in front of it.
*/

const KEY = "sti-monitor";

export type MonitorPrefs = {
  /* Multiplies the dwell, and therefore divides the scroll speed: the travel
     covers a fixed distance (the list) in a fixed fraction of the dwell, so
     a longer dwell is literally a slower crawl. One knob, both effects, which
     is why there is no separate "scroll speed". */
  pace: number;
};

export const PACE_OPTIONS = [
  { value: 0.6, label: "Fast", hint: "For a desk, skimming" },
  { value: 0.8, label: "Brisk", hint: "" },
  { value: 1, label: "Steady", hint: "Default — readable from across a room" },
  { value: 1.5, label: "Relaxed", hint: "" },
  { value: 2.2, label: "Slow", hint: "For a big screen at the far end of a shop" },
] as const;

export const DEFAULT_MONITOR_PREFS: MonitorPrefs = { pace: 1 };

export function readMonitorPrefs(): MonitorPrefs {
  if (typeof window === "undefined") return DEFAULT_MONITOR_PREFS;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    const pace = Number(raw?.pace);
    /* A value from a hand-edited or stale entry must not be able to freeze the
       board or spin it: clamped rather than trusted or rejected. */
    return { pace: Number.isFinite(pace) ? Math.min(4, Math.max(0.4, pace)) : 1 };
  } catch {
    return DEFAULT_MONITOR_PREFS;
  }
}

export function writeMonitorPrefs(prefs: MonitorPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* Private mode, quota, storage disabled. The board still runs at the
       default — never break a screen over a preference. */
  }
}

/*
  Reads on mount rather than during render, because the server has no
  localStorage and rendering the stored pace directly would be a hydration
  mismatch on every board that has ever been tuned.

  The `storage` listener is what makes a second tab useful: tune the pace on the
  laptop, and the board already open on the TV picks it up without somebody
  walking over to reload it.
*/
export function useMonitorPrefs(): MonitorPrefs {
  const [prefs, setPrefs] = useState<MonitorPrefs>(DEFAULT_MONITOR_PREFS);

  useEffect(() => {
    setPrefs(readMonitorPrefs());
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setPrefs(readMonitorPrefs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return prefs;
}
