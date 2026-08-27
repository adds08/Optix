"use client";

import { useCallback, useEffect, useState } from "react";
import type { NavGroup, NavItem } from "./nav-config";

/*
  Pinned navigation rows (STI-1203).

  A star on any sidebar row lifts it into a Pinned section at the head of the
  pane, so the four screens somebody actually lives in are one click away
  regardless of which module the rail is currently pointing at.

  Two rules are the whole story, and both are about what a pin must NOT be:

    - **A pin stores an `id`, never an href.** Renaming a route would otherwise
      strand every pin that named it, silently — the row simply stops appearing
      and nobody connects that to the rename three weeks earlier. `NavItem.id`
      exists for this and is documented as never-derived-from-the-route.

    - **Pins are rendered by intersecting with the ALREADY-PERMISSION-FILTERED
      groups, never read out of storage and linked directly.** Otherwise
      revoking somebody's `assignment.read` leaves a working Custody link in
      their sidebar, and a client-side list becomes access control. Same class
      of mistake as the job-scope rule in `.claude/rules/web.md`.

  Per-browser was the explicit ask, so this is localStorage and not the
  `user_preferences.dashboard` jsonb column — that stays available if pins
  should ever follow a person between devices.
*/

const KEY = "sti-pins";

/* Storage can be unavailable (private mode), full, or hold whatever a previous
   version of this code wrote. None of that is allowed to take the navigation
   down with it, so both sides swallow and fall back to "no pins" — the sidebar
   is still completely usable without them. */
function read(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* Quota or disabled storage. The pin still works for this session; it just
       will not survive a reload. Never break rendering over a cache. */
  }
}

/*
  The pinned rows, resolved against what this actor may actually see.

  Pure, and the only place the intersection happens. An id in storage that
  matches nothing — a removed route, a permission since revoked, a typo from a
  hand-edited localStorage — simply does not come out, which is what makes
  "unknown ids are ignored" a property of the data flow rather than a branch
  somebody has to remember to write.

  Ordered by the NAVIGATION, not by when each was pinned: the tree's order is
  stable and already learned, and it means the stored value never has to carry
  an ordering to be correct.

  The `seen` set is not defensive padding. `NavItem.id` uniqueness is a
  convention, not a type — and `FIELD_NAV` and `DESK_NAV` already share the id
  `desk` deliberately, so "two items with one id" is one careless edit from
  being true inside a single array. Without this, that edit surfaces as a
  duplicate React key and two identical pinned rows rather than as anything
  that names the real mistake.
*/
export function pinnedItems(groups: NavGroup[], pins: Set<string>): NavItem[] {
  const seen = new Set<string>();
  const out: NavItem[] = [];
  for (const g of groups) {
    for (const item of g.items) {
      if (!pins.has(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

export function useNavPins() {
  /*
    Starts empty and fills in an effect rather than reading storage during
    render — the sidebar is server-rendered, so a first client render that
    already knew the pins would not match the HTML React is hydrating against.
    The cost is one frame with no Pinned section; the fade on the section
    covers it.
  */
  const [pins, setPins] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setPins(new Set(read()));
  }, []);

  const toggle = useCallback((id: string) => {
    setPins((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      write([...next]);
      return next;
    });
  }, []);

  return { pins, toggle };
}
