# Tabs you can actually see, and one strip instead of three sections

Reported directly: *"the tabs are very hard to see, in entire pages, across all
pages, can you improve that please."* Then, on the same page: fold Job history
into the same tab strip as Tools and Equipment, and hide the ones a role can
never use.

## Why every tab in the app was hard to read

One component, `apps/web/components/ui/tabs.tsx`, backs every tab strip in the
product (`/custody`, `/people/[id]`, `/org-chart`, `/onboarding/progress`). Two
separate defects stacked on top of each other:

**The bar didn't separate from the page.** `TabsList` filled with `bg-muted`
and carried no border. Measured in oklch lightness: `--muted` sits within
0.012 of `--background` in the light palette, and is 0.032 *darker* than it in
the dark one. Either way, a bar with no border and almost no background delta
reads as part of the page it sits on, not a control floating above it.

**The active pill barely stood out from the bar.** The shadcn default used
`bg-background` for the active state — inside a list already coloured close to
`--background`'s own value, so the "selected" pill and its container were
sometimes within a few points of the same lightness, no border, no shadow.

Both are fixed at the one component, not per page — a shared primitive with a
contrast bug is a bug on every page that imports it, and patching call sites
one at a time would have left the fifth page exactly as broken as this one was.

**The fix:**
- `TabsList` now carries `border border-border` — `--border` is calibrated (per
  its own comment in `globals.css`) to clear its neighbour by a real margin in
  both themes, which a background-only delta was not.
- The active trigger uses `bg-card` (checked against `bg-background`, which
  fails outright in dark mode — `--background` is *darker* than `--muted`
  there) plus a real border and `shadow-sm`. Measured: 0.042 of lightness above
  the list in light mode, 0.013 in dark — small numbers, but both positive
  where the previous pairing risked being flat or negative.
- Inactive labels moved from a manual `text-foreground/60` to
  `text-muted-foreground` at full opacity — the token this app already uses
  everywhere else for "present but secondary," calibrated for contrast rather
  than an arbitrary fraction.

Verified in both themes on `/people/[id]`: the active pill now reads as a
distinct object with a visible edge in light mode and in dark, matching the
reference the client supplied (a white/near-white pill on a bordered grey bar).

## `/people/[id]`: one tab strip, not two tabs above a third table

Previously: Tools/Equipment tabbed together, with Job history as its own
always-visible section underneath. Asked for directly: *"add everything to
such tab, like Job history, Small Tools assigned, equipment assigned and so
on."*

Now: **Tools, Equipment, Job history** are three tabs in one strip, each with
its own count badge.

## Tools and Equipment are omitted, not disabled, for roles that can't hold custody

*"Not all roles have this anyway"* — also said directly. `employee.get` now
returns `roleCanHoldCustody`, straight off `role.canHoldCustody` (the same flag
that already replaced a hard-coded list of custodian role names elsewhere in
this codebase — see that column's own comment). A project manager or an office
admin cannot be named custodian of anything in this system, so their Tools and
Equipment tabs would always open on the same empty state. That isn't a feature
worth a tab; it's a click that goes nowhere, repeated on every PM's page.

Job history has no such gate — `employeeProjectAssignment` is written for a
posting regardless of custody, so it shows for everyone.

Default tab: a role that cannot hold custody lands on Job history, since the
other two aren't offered. A role that can, but holds no tools, lands on
Equipment if that's where something actually is — the same "open on whichever
tab has content" rule from the last change, now covering the fuller decision.

## A stale API process, caught by checking rather than trusting the screen

`employee.get`'s new field didn't show up on the first verification pass — the
running api container had the edited source on disk but was still serving a
process started before the edit. `docker compose restart api` fixed it. Worth
naming because the failure mode was silent and specific: the page rendered
with zero tabs rather than an error, which would have read as "the gate is
somehow always false" if I'd trusted the browser over checking the raw API
response first.

## Verified

- `pnpm typecheck` clean.
- 568 tests, run inside the api container against the demo fixture.
- Both themes, `/people/[id]`, driven live: a PM (`role.canHoldCustody = false`)
  shows a single Job history tab; a real custodian (Alejandro Capuchino, 19
  tools + 1 trailer) shows all three with correct counts, tab bar and active
  pill both visibly distinct from the page in light and dark.
