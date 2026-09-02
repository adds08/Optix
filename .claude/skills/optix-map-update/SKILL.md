---
name: optix-map-update
description: Fast, code-only refresh of the Optix screen map at .claude/optix-screen-map.yaml -- re-walks nav-config.ts and the page source to catch new/removed/changed routes, WITHOUT re-reading memory or changelogs. Use after routine code changes (a page added, a route renamed, a nav item's permission changed) to keep the map from drifting. If the map does not exist yet, or several sources besides the code have moved, use optix-map-evaluate for a full rebuild instead -- this skill only syncs what the code walk can see.
---

# Optix Map Update

## The difference from optix-map-evaluate, precisely

`optix-map-evaluate` synthesizes from four sources: nav-config, page source,
`docs/`, and the assistant's own memory. That is expensive and is meant to run
occasionally. This skill re-reads exactly ONE of those four — the code — and
reconciles the map against it. It never opens a changelog and never reads a
memory file. That is the entire reason it is fast enough to run after an
ordinary change instead of being deferred until the map is embarrassingly
stale.

If `.claude/optix-screen-map.yaml` does not exist, stop and say so — run
`optix-map-evaluate` first. This skill has nothing to diff against and no
mandate to invent the narrative fields (`purpose`, `known_gaps`, `sources`)
that only a full evaluation is allowed to write.

## Procedure

**1. Re-enumerate routes exactly as optix-map-evaluate's step 1 does.**

Walk `apps/web/components/sti/nav-config.ts` (`FIELD_NAV`, `DESK_NAV`) and
`apps/web/app/(app)/**/page.tsx`. This is the full current truth about what
routes exist, what group and permission each carries, and what layout
(`desk`/`field`/`both`/`unlisted`) applies.

**2. Diff against the existing map's route keys.**

- **A route in code but not in the map** — add a new entry, but ONLY the
  fields the code walk can honestly fill: `id`, `label`, `group`, `layout`,
  `permission`, `file`. Set `purpose: null`, `features: []`, `known_gaps: []`,
  `sources: []`, and add `needs_full_evaluation: true`. Do not guess at prose
  a full evaluation should write — an honest gap is more useful than an
  invented one.
- **A route in the map but not in code** — do not delete the entry. Mark it
  `stale: true` with `stale_since: <today>` and leave everything else as it
  was, the same way `asset.verifyProjection` reports a divergence rather than
  silently repairing or erasing it. A route that vanished is exactly the kind
  of thing worth a human noticing, not quietly forgetting.
- **A route present in both** — refresh only the CODE-DERIVED fields
  (`label`, `group`, `permission`, `layout`, `file` if the page moved). Leave
  `purpose`, `known_gaps`, and `sources` untouched — those came from reading
  changelogs and memory, which this skill does not repeat, and overwriting
  them with nothing would be a regression, not a refresh.

**3. Light-touch feature re-scan, only for entries already flagged.**

If an existing entry already has `needs_full_evaluation: true` from a prior
update run, take this chance to re-open its `page.tsx` and fill in a first-pass
`features` list from what's visibly there (same grounding rule as evaluate's
step 2) — cheap to do while the file is already open, and it turns a stub
entry into a usable one sooner than waiting for the next full evaluation.
Do not do this for entries that already have a real `features` list; a light
re-scan is not a substitute for evaluate's deeper read and re-running it on
every entry every time would just be `optix-map-evaluate` with extra steps.

**4. Bump `_meta.last_code_sync` to today. Never touch `_meta.last_full_evaluation`.**

The gap between the two timestamps is the map's own honesty about how stale
its narrative content is — widen it by running this skill, close it by
running `optix-map-evaluate`.

**5. Report a short diff, not the whole file.**

State plainly: routes added (with `needs_full_evaluation` noted), routes
marked stale, routes whose code-derived fields changed. If nothing changed,
say that — a no-op sync is a normal, useful outcome, not a failure to find
something to report.

## What this is not

Not a way to avoid ever running `optix-map-evaluate`. A map built entirely out
of `optix-map-update` runs accumulates stub entries and stale flags forever
and never gets the changelog/memory synthesis that makes it worth reading in
the first place. Run the full evaluation periodically, and definitely before
leaning on the map for something that matters.
