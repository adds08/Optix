---
name: optix-map-evaluate
description: Build or fully rebuild the Optix screen map at .claude/optix-screen-map.yaml -- one entry per screen, synthesized from nav-config.ts, the actual page source, docs/architecture, docs/changelogs, and the assistant's own persistent memory of this project. Use when the map does not exist yet, when it has visibly drifted from several sources at once, or when explicitly asked to "evaluate" or "rebuild" the screen map. For a fast, code-only refresh after routine changes, use optix-map-update instead -- it does not touch memory or changelogs and is not a substitute for this.
---

# Optix Map Evaluate

## What this produces, and why it is not a docs/architecture file

One YAML file, `.claude/optix-screen-map.yaml`, one entry per screen, meant to be
read by an agent (this skill's own caller, next time it starts cold) to get
oriented in seconds instead of re-deriving "what does /jobsites actually do"
from scratch.

`docs/architecture/*.md` was the obvious place to put this and is the wrong one.
That folder's own README states its charter directly: *"derived from the code
rather than from memory or from an earlier document."* This map is built FROM
memory and changelogs on purpose — that is what makes it more useful than
`05-features.md`, which already covers feature-by-feature status. Putting a
memory-sourced file in a folder that promises code-only derivation would break
the promise every other file there makes. `.claude/` — beside `rules/` and
`skills/` — is where agent-context that isn't a human-facing doc belongs.

## The schema

One YAML mapping per route, keyed by route path:

```yaml
_meta:
  last_full_evaluation: 2026-09-04
  last_code_sync: 2026-09-04       # bumped by optix-map-update; see that skill

/jobsites:
  id: tools-by-jobsite              # the NavItem id in nav-config.ts — stable, never the route
  label: Tools by Jobsite
  group: Operations
  layout: desk                      # desk | field | both (FIELD_NAV vs DESK_NAV) | unlisted
  permission: asset.read
  file: apps/web/app/(app)/jobsites/page.tsx
  purpose: >
    One card per job: the crew (foreman + rig) and the tools working it.
    The control hub for custody by jobsite.
  features:
    - Card view and table view, toggled per job
    - Search across tool tag, foreman name, and rig unit
    - Team strip: assign/remove PM and superintendent (roster-only, no custody move)
    - Crew rows: assign a foreman (moves tools), add tools, pick a rig
  key_procedures:
    - projectTeam.all
    - projectTeam.assign / remove
    - asset.list
  navigation: Operations group in the desk sidebar, or /jobsites directly
  known_gaps:
    - "No reportsTo picker on this page's team strip as of 2026-09-03 — set from /org-chart instead"
  sources:
    - docs/changelogs/2026-09-02-the-sheet-stops-scrolling-sideways-and-search-shows-its-work.md
    - memory:crew-data-is-central-screens-are-views
```

`sources` cites WHERE a claim came from — a doc path, a changelog filename, or
`memory:<slug>` for a fact that came from the assistant's own persistent memory.
An entry with no sources beyond the code walk is legitimate (most screens need
no changelog digging); an entry making a claim with no source is the failure
mode to avoid — this map is only worth trusting if every non-obvious claim in
it can be traced back to where it came from.

## Procedure

**1. Enumerate every screen — not just what's in the nav.**

Read `apps/web/components/sti/nav-config.ts` for `FIELD_NAV` and `DESK_NAV`:
every `NavItem`'s `id`, `href`, `label`, `perm`, and which group it sits in.
Then walk `apps/web/app/(app)/**/page.tsx` (a `find` or `Glob` is enough) and
diff that list against the nav — routes that exist in code but not in the nav
(`/old-dash`, detail routes like `/people/[id]`, anything behind a feature
flag) still get an entry, marked `layout: unlisted` with a note on how a
person actually reaches it (a row link, a redirect, nothing yet).

**2. Ground `features` in the actual page source, not assumption.**

Open each `page.tsx` (and its main child components, one level deep — a card
component like `jobsite-crew-card.tsx` is where the real capability often
lives, not the page shell). List what is ACTUALLY there: tabs, filters,
bulk actions, dialogs, an inline editor. This is the part most worth getting
right, and the part a doc alone cannot give you — `05-features.md` says a
feature is "built"; it does not say the by-jobsite tab has a search box and a
jobsite filter.

If the screen count is large enough that reading every file would burn the
whole context window, delegate the READING (not the synthesis) to an Explore
subagent per group of screens, and ask it to return the concrete UI elements
found, not a summary of "what the page does" — you still write the map
entries yourself from what it reports.

**3. Cross-reference `docs/architecture/`, especially `05-features.md`.**

For each screen's feature area, note the STATUS `05-features.md` already
records (built / built, unreached / not built) and the procedures and tables
it names. This catches a screen with no working backend before that gets
recorded in the map as if it were live.

**4. Pull WHY and WHAT-WAS-DECIDED-AGAINST from `docs/changelogs/`.**

`grep -rl` the screen's route, component names, and any distinctive feature
name across `docs/changelogs/*.md`. A changelog entry is where "we tried X and
reverted it" or "Y is deliberately not built" lives — exactly the context a
code read alone cannot recover, and exactly what stops this map from getting
an agent to propose rebuilding something already tried and rejected.

**5. Fold in relevant facts from the assistant's own persistent memory.**

Read every file under the memory directory named in this session's system
context (not just the index — `MEMORY.md` is a pointer list, the actual facts
are in the files it points to). A memory fact belongs on a screen's entry only
if it is ABOUT that screen specifically (a project fact like "the seed only
has reporting data on two jobs" belongs on `/org-chart`'s entry, not on every
entry). Cite it as `memory:<slug>`.

**6. Write the file, in full.**

This is a rebuild, not a patch — overwrite `.claude/optix-screen-map.yaml`
entirely with a freshly synthesized `_meta.last_full_evaluation` timestamp
(today's date) and `_meta.last_code_sync` set to the same date (a full
evaluation is also, trivially, a code sync). Keep entries alphabetized by
route for a stable diff the next time this runs.

**7. Say what you found that surprised you.**

If evaluating the map surfaced something genuinely wrong elsewhere — a doc
that disagreed with the code, a changelog that named a screen that no longer
exists, a memory fact that turned out stale — fix that in the same change
(CLAUDE.md rule 3) rather than silently encoding the correct answer only into
the map and leaving the wrong source standing.

## What this is not

Not a substitute for `docs/architecture/05-features.md` or the changelogs —
this map is a synthesis INDEX pointing back at them, not a replacement. Do not
let the map become the only place a fact lives; if something belongs in a doc
or a memory and isn't there yet, add it there, and have the map cite it.

Not something to run on every small change — that is `optix-map-update`'s job.
Reach for this skill for the first build, or when several sources have moved
under the map at once and a fast code-only sync would just be papering over
drift that needs a real re-read.
