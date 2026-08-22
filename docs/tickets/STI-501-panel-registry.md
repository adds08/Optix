# STI-501 — Permission-driven panel registry

**Phase:** 5 — Desk views by role
**Size:** 2 units
**Status:** **DONE — 2026-08-22.** `apps/web/components/desk/panel-registry.tsx`, rendered at `/desk`. Composition is `PANEL_REGISTRY.filter(panelVisible)` — no role name. The width rule (`tierAtLeast`) lives in `packages/types` and is unit-tested over all sixteen tier pairs, because `apps/web` has no test runner and adding one was not this ticket.
**Blocks:** STI-502

---

## Why this exists

`SYSTEM_PLAN.md` §6.5. The Desk is the intended long-term surface for the whole
system, and §7 makes the reason for a registry explicit: Release 2's
question-and-answer interface assembles views from the registry, so *"Release 2 adds
panels without touching role logic"*.

Verified 2026-08-16: `PANEL_REGISTRY` appears **only in markdown**. Zero occurrences
in any `.ts` or `.tsx`.

What exists instead:

- `apps/web/app/(app)/home/page.tsx` (457 lines), self-described at `:56` as "the desk
  dashboard". Composition is `WIDGET_DEFS` + `widgetVisibility(prefs)`
  (`apps/web/components/dashboard-widgets.tsx:43,51,61`) — driven by **user theme
  preferences, not permissions**. The defs carry no `permission` or `role` field.
- Role handling is hard-coded elsewhere: `FIELD_NAV` and `DESK_NAV`
  (`apps/web/components/sti/nav-config.ts:39,50`) are two literal arrays selected by
  `navFor(role)` (`:94-96`) off a hardcoded
  `FIELD_ROLES = new Set(["foreman","superintendent"])` (`:88`). The per-item `perm:`
  strings gate nav links, not panels.
- `apps/mobile/app/(tabs)/desk.tsx` is a flat list of every asset via one
  `asset.list` query (`:28`) — no panels, no permissions, no scope.

## Acceptance criteria

1. A declarative registry: each panel is `{ id, permission, component }`, matching
   §6.5's shape.
2. The desk composes itself by filtering the registry on the actor's permissions and
   rendering each survivor with the actor's visible scope. **No role names anywhere**
   in the composition (§9).
3. Adding a panel is a one-line registry entry with **no change to role logic**. Prove
   it: add a throwaway panel in a scratch commit, show the diff is one line, and do
   not commit it.
4. Scope comes from STI-302's ladder and is applied to the panel's query, never as a
   post-filter (§7, non-negotiable).
5. A user with no matching permissions gets an empty desk with an explanation, not a
   crash and not a blank screen.
6. `widgetVisibility(prefs)` still works. Preferences decide **layout**; permissions
   decide **existence**. Keeping these separate is the point — a user must not be
   able to hide a panel and thereby escape a permission check, nor reveal one.
7. Verified in a browser as at least two different roles. Blocked on STI-304 accounts.

## Deliberately out of scope

The mobile Desk (`apps/mobile/app/(tabs)/desk.tsx`) and the Release 2 generative
assembly (§7). This ticket is the web registry only. `CLAUDE.md` also forbids
reintroducing a shared frontend package — do not create one to share the registry
with mobile; prove a second consumer first.

## Files

- `apps/web/components/dashboard-widgets.tsx:43,51,61`
- `apps/web/app/(app)/home/page.tsx:56`
- `apps/web/components/sti/nav-config.ts:39,50,88,94-96`
- `packages/api-contracts/src/scope.ts` — the ladder from STI-302
