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

/*
  One-shot marker meaning "this navigation to /home is a fresh sign-in".

  `sessionStorage`, not `localStorage`: it must not survive the tab, or the
  redirect would fire again on a reload a week later. Set by the sign-in paths,
  consumed by `AppShell` on the first render of /home.
*/
export const LAND_ON_PIN = "sti-land-on-pin";

/* The stored order, for callers outside the hook — `AppShell` resolves the
   landing route before the sidebar (and therefore `useNavPins`) has mounted. */
export function readPinOrder(): string[] {
  return read();
}

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

  Ordered by the STORED ORDER as of 2026-08-28, not by the navigation.

  It used to sort by the tree, on the reasoning that the tree's order is stable
  and already learned. That was right until pins could be rearranged: a list you
  can drag but which re-sorts itself is worse than one you cannot drag at all.
  The stored array has always been an array, so nothing about the format
  changed — only whether its order was believed.

  The `seen` set is not defensive padding. `NavItem.id` uniqueness is a
  convention, not a type — and `FIELD_NAV` and `DESK_NAV` already share the id
  `desk` deliberately, so "two items with one id" is one careless edit from
  being true inside a single array. Without this, that edit surfaces as a
  duplicate React key and two identical pinned rows rather than as anything
  that names the real mistake.
*/
export function pinnedItems(groups: NavGroup[], order: readonly string[]): NavItem[] {
  /* Built from the groups the shell has ALREADY permission-filtered, which is
     what keeps a hand-edited storage key from conjuring a link. Walking the
     stored order and looking each id up here means an unknown id resolves to
     nothing and simply falls out — the same property as before, arrived at from
     the other direction. */
  const byId = new Map<string, NavItem>();
  for (const g of groups) {
    for (const item of g.items) if (!byId.has(item.id)) byId.set(item.id, item);
  }
  const seen = new Set<string>();
  const out: NavItem[] = [];
  for (const id of order) {
    if (seen.has(id)) continue;
    const item = byId.get(id);
    if (!item) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

/*
  The row a session should land on.

  "The first pin opens by default" — so the top of somebody's own list is where
  the product starts, rather than a fixed route chosen for everybody. Returns
  null when there are no pins, or when the first pinned id no longer resolves,
  and the caller keeps its existing destination in that case.

  Resolved through `pinnedItems`, so it inherits the permission intersection
  rather than reimplementing it: a pin naming a route the actor may not open
  cannot become a redirect, which would be the same forgeability bug in a more
  damaging place.
*/
export function defaultPinnedHref(groups: NavGroup[], order: readonly string[]): string | null {
  return pinnedItems(groups, order)[0]?.href ?? null;
}

export function useNavPins() {
  /*
    Starts empty and fills in an effect rather than reading storage during
    render — the sidebar is server-rendered, so a first client render that
    already knew the pins would not match the HTML React is hydrating against.
    The cost is one frame with no Pinned section; the fade on the section
    covers it.
  */
  const [order, setOrder] = useState<string[]>(() => []);

  useEffect(() => {
    setOrder(read());
  }, []);

  const toggle = useCallback((id: string) => {
    setOrder((prev) => {
      /* Appended, not inserted: a new pin goes to the BOTTOM so it cannot
         silently take over the landing route from the one already at the top. */
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      write(next);
      return next;
    });
  }, []);

  /*
    Move one pin up or down by a place.

    Up/down rather than drag-and-drop, deliberately. The list is three or four
    rows in a 48px-wide rail's companion pane, dragging inside a scrollable
    sidebar is fiddly on a touchpad and impossible on the phone sheet, and the
    only ordering anybody actually wants is "put that one at the top". Two
    buttons do that in two clicks and need no library.

    Out-of-range moves are a no-op rather than a wrap: the first item's "up"
    doing nothing is what a person expects; jumping to the bottom is not.
  */
  const move = useCallback((id: string, delta: -1 | 1) => {
    setOrder((prev) => {
      const from = prev.indexOf(id);
      if (from < 0) return prev;
      const to = from + delta;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to]!, next[from]!];
      write(next);
      return next;
    });
  }, []);

  /* Membership, for the star's filled state. Derived rather than stored beside
     the array so the two can never disagree about what is pinned. */
  const pins = new Set(order);

  return { pins, order, toggle, move };
}

export type NavPins = ReturnType<typeof useNavPins>;
