> **ARCHIVED 2026-08-29. Historical record, not instructions.**
>
> Written 2026-07-27 to hand over the Tool Register redesign. That register has been
> rebuilt several times since — the table system, the row menus, the column menu,
> freezing and the grid all postdate this document. It is kept because the two design
> decisions it records still explain why the register looks the way it does.
>
> For the table system as it is now: [`../../.claude/rules/web.md`](../../.claude/rules/web.md)
> and [`../architecture/03-frontend.md`](../architecture/03-frontend.md).

# Handoff — Tool Register redesign

Written 2026-07-27. Read this first if you are picking up the Tool Register work.

---

## What happened

The Tool Register page in the web app was rebuilt to look and behave more like a
real equipment catalogue instead of a flat table. The design was worked out first
in `prototype/index.html` (a standalone, no-build mockup), then ported into the
production Next.js app.

Reference for the design direction: United Rentals' own catalogue pages, which
Urban already uses as a vendor. What was borrowed and what was deliberately left
alone is written up in `prototype/README.md`.

---

## Files changed — this is the complete list

**Production app (the part that talks to the real database):**

| File | State |
|---|---|
| `apps/web/app/(app)/tools/page.tsx` | rewritten (+270 / −102) |
| `apps/web/components/sti/facets.tsx` | new — filter rail UI |
| `apps/web/components/sti/flags.tsx` | new — flag logic + badges |
| `apps/web/components/sti/asset-card.tsx` | new — card view of a register row |

Since the first draft of this handoff, all four have been revised: two lint
errors fixed and the design toned down (see below).

**Prototype (design reference only — no API, no database):**

| File | State |
|---|---|
| `prototype/index.html` | rewritten |
| `prototype/data.js` | added a `photoUrl` field to each asset |
| `prototype/README.md` | documents what was borrowed from UR and what wasn't |

**Also added, unrelated to the redesign:**

- `UR_Orders_Sample_Export.xlsx` — a 60-order sample pulled from Urban's United
  Rentals account (#2785573), for reference. Read-only export; no orders,
  quotes or carts were touched.

> ⚠️ **Nothing else in this repo was touched.** At the time of writing there were
> ~100 uncommitted files already sitting in the working tree — API, database,
> mobile, messaging — from earlier work. Those are *not* part of this change.
> Do not `git add .` and commit the lot as one thing.

---

## What the page does now

- **Filter rail down the left** — category, status, and flags, each with a count.
- **Cards / Table toggle** — cards by default, table for dense scanning.
- **Value weight** — tools at or above the high-value threshold get a marked left
  edge and a darker price, in both views. A $33k total station should never read
  the same as a $260 drill.
- **Flag badges** — `Warranty ends soon`, `Warranty expired`.
- **Result count**, removable filter pills, and an empty state that points at the
  filter rail rather than going blank.

### The design was toned down on 2026-07-27

The first pass shouted. Four changes, all in the same direction:

- **No empty photo frame.** There is no photo column on `asset`, so a 112px
  placeholder appeared on *every* card — a third of the surface given to
  something that could never be information. The frame now renders only when
  `photoUrl` is set, so wiring photos up later changes nothing here.
- **High value is no longer badged.** It is a permanent attribute, not an alert,
  and the card already said it twice (marked edge, heavier price). A third
  signal made a register of ordinary tools look like a list of problems. It
  stays in `flagsFor` because the rail still filters on it.
- **Quieter value weight** — a 2px edge at 60% primary instead of 3px solid, and
  weight/contrast on the price instead of bold plus a size jump.
- **Less brand colour on minor state** — the view toggle is a segmented control
  rather than a filled primary button, and the facet checkbox uses foreground
  rather than primary.

Net effect on the seeded fleet: 4 of 14 cards carry a badge instead of 7, and
only 2 of those are coloured.

Everything that was on the page before still works: search, new tool, edit,
delete (with the router's refusal message shown inline), CSV import, and the
Assign / Transfer / Return row menu with its permission gate.

---

## Two decisions worth knowing before you change anything

### 1. Filtering moved to the client, on purpose

`asset.list` is now called with only `search`. Category, status and flags are
applied in the browser.

This is because of how the facet counts work. Each count is computed with *its
own* filter lifted, so the number answers **"how many would I get if I clicked
this"** rather than "how many are showing right now". If the status filter were
pushed to the server, the response would only contain one status and every other
count would read 0 — which is what the old page did, and why it only showed
counts while the filter was set to "All".

The trade is that the whole tenant's asset list comes down in one fetch. Fine at
Urban's current fleet size. If a tenant outgrows it, `asset.list` already accepts
`status` / `projectId` / `custodianId`, so the server-side path is still there —
but the counts will need rethinking at the same time, probably as a separate
`asset.facetCounts` procedure.

### 2. The high-value threshold is not a made-up number

`flags.tsx` imports `DEFAULT_HIGH_VALUE_THRESHOLD` (5000) from
`@stinventory/types` — the same constant the API uses in `apply-action.ts` to
decide whether a custody hand-off needs approval.

So a tool badged **High value** in the register is exactly the tool that will
demand a signature when someone tries to hand it over. Those two should stay
tied. If per-tenant thresholds ever need to show in the UI, the real value lives
on `tenantSettings.highValueThreshold` and is currently **not** exposed to the
frontend — that would need adding to `identity.me` or a settings query.

---

## Known gaps

- **No photos.** There is no `photo_url` column on `asset`. The card renders an
  empty frame rather than pretending otherwise. Wiring this up needs a schema
  column, an upload endpoint, and somewhere to put the files — none of which
  exist. `AssetCardRow` already carries an optional `photoUrl`, so the UI side is
  ready.
- **No "Service due" flag.** There is no maintenance table
  (`packages/db/src/schema/` has no maintenance schema; see `AGENTS.md` §8). The
  prototype shows this badge; production deliberately omits it rather than ship a
  badge that never lights up.
- **The page has never been rendered.** See below.

---

## Verification status

Updated 2026-07-27, after the checks below were actually run.

**Now done:**

- `pnpm typecheck` — clean across all 11 packages.
- `pnpm test` — 59 tests pass (none cover this page; they cover the domain core).
- `pnpm --filter @stinventory/web lint` — clean. It was **not** clean when this
  handoff was first written; the redesign introduced two errors:
  - `tools/page.tsx` used a ternary as a statement to toggle a Set;
  - `asset-card.tsx` carried an `eslint-disable` for a rule this project does
    not configure, which is itself an error.
- `/tools` returns 200 and the web container logs no runtime errors.
- The seeded data exercises the rail: 5 categories, 4 statuses, 3 of 14 tools
  high-value, 2 warranties expired and 2 ending soon. `available` has a count of
  0, so that row renders disabled — which is the intended "the absence is
  information" behaviour, worth not mistaking for a bug.

**Still not verified — needs a human with a browser:**

- Layout, spacing and responsive behaviour at real widths.
- Dark mode.
- Whether the facet counts *read* right to someone using them, as opposed to
  being arithmetically correct.

---

## First steps

```bash
cd STInventory
make ENV=local up        # postgres + api + web
make ENV=local seed      # sample data
```

Then open http://localhost:3100 → log in as `owner@stinventory.local`
(password `stinventory-demo`) → **Tool Register**.

Check in this order — the page renders and the counts are arithmetically
correct, so what is left is judgement, not smoke-testing:

1. Does the filter rail sit correctly next to the results at desktop and narrow
   widths? This is the one thing most likely to be wrong.
2. Click through the facets. Do the counts *read* right while you use them?
3. Toggle Cards / Table. After the toning-down, do the high-value tools still
   stand out enough — or has the signal gone too far the other way?
4. Dark mode.
5. Confirm the row menu still assigns, transfers and returns, and that a
   non-admin user still can't see it.

---

## Reasonable next moves

- **Port the same treatment to `/custody`.** It is still two plain tables behind
  Held / Moving tabs. The only control on the page is the tab switch — there is
  no search box and no filter controls; the lists are narrowed in code, not by
  the user. `assignment.list` already returns everything a filter rail would need
  (custodian, project, type, and an `overdue` flag it computes server-side), so
  this is frontend-only work. `facets.tsx` was written to be reused.
- **Make the dashboard KPI tiles clickable**, landing on a pre-filtered register.
  `Metric` in `components/sti/page.tsx` has no `href` today. Use a real URL
  (`/tools?status=lost`) read via `useSearchParams`, not component state, so the
  links can be shared and the back button behaves.
- **Deal with the ~100 uncommitted files** before layering more on top. Worth
  grouping into finished vs half-done first.
