# Jobsites gains a card view whose tools open in a right sheet

The jobsites board is one detailed vertical list: every job a full-width
section with crews, rigs and tool tables inline. Urban asked for a second way
to look at the same thing — a compact card per jobsite, with the tools arriving
in a panel rather than inline — without the data changing in any way between
the two. "All data as is should be arranged as is" was the brief, verbatim, and
it is the design constraint the whole change hangs on.

## What changed

### One derivation, two layouts

`components/jobsite-card-view.tsx` is new: a grid of compact card faces (icon
chip, name, crew count, code chip, tool count, value, gap badge) and a
right-side `Sheet` that opens on click, showing that jobsite's tools — one
section per crew with the foreman's name and rig units, plus the loose-tool
section under the same labels the list uses ("On site, nobody holding" /
"Waiting in the yard").

The component takes the page's existing `cards` array and derives **nothing**
of its own. That array is where scope, all six filters, the Pool split, search
and sort are already applied — the `toolOk` predicate exists as one function
precisely because it was once copied four places — so the two views cannot
disagree about what is on a job. The sheet resolves its card from the live
array by id on every render rather than snapshotting on click: a tool moved
through its ⋯ menu inside the sheet invalidates `asset.list`, the page
rebuilds, and the open sheet shows the result instead of the pre-mutation
world.

Reused unchanged: `ui/sheet.tsx` (existed, unconsumed on this page),
`ToolTable` (fetches nothing, owns its own sort and horizontal overflow — the
sheet just supplies the bordered wrapper the table's `.sti-grid` styling
expects), `ToolMenu`, `Highlight`. The per-tool actions gate is the same
`canActTools` the list passes, so what a person may do to a tool does not
depend on which layout they picked.

### The toggle, and where the choice lives

A "List | Cards" segmented control sits first in the summary line's right
cluster, in the exact markup pattern of the Jobs/Pool toggle beside it — text,
not icons, so the pair read as siblings. There was no view-mode toggle
anywhere in the app before this; this is the precedent now.

The choice persists per browser under `sti-jobsites-view`, following the
nav-pins storage pattern: default `"list"`, storage read inside an effect with
a try/catch that never breaks rendering over a cache. Defaulting to the list
and reading late is load-bearing twice over — the server HTML and first client
render agree (no hydration mismatch), and e2e contexts, which start with clean
storage, always land on the list view that every existing jobsites spec
silently assumes.

The master expand/collapse button hides in Cards mode: it only drives the
list's open-state maps, and a control that does nothing teaches people to stop
trusting controls.

### The page knows its own sentinels

The card view needs an icon per card kind (job / yard / between-jobs), but the
`YARD`/`NOJOB` sentinel ids live in the page. The page maps the icon onto each
card at the call site rather than the component re-deriving kind from string
literals — duplicating those sentinels across two files is how the views would
have started to drift.

## Verified

- Driven in a real browser against the running stack (headless Chromium,
  owner account), all eight acceptance checks passing: default view unchanged
  with the toggle present; the grid rendering exactly one card per list
  section with byte-identical gap badges between modes; the sheet's tables
  ruled, wrapper-bordered, and overflowing internally with the document never
  scrolling sideways (1440px and 800px); search narrowing both views and
  `<mark>` highlights reaching the sheet's rows; Pool and job-scope behaving
  identically in both modes; persistence across reloads in both directions;
  zero console errors throughout.
- **Modal-over-modal verified in the browser, not argued from source**: a
  Radix Dialog (ToolMenu's report dialog) opened from inside the Radix Sheet
  paints above it, takes input, and Escape closes only the top layer. This was
  the one behaviour no amount of source reading could settle.
- Zero ledger writes during the whole pass — confirmed by counting
  `tbl_ops_transaction` rows, not by assuming.
- `pnpm typecheck` and lint clean; `turbo run test` green across all eight
  packages in the api container.
- The four e2e specs that measure this page (`no-layout-shift`,
  `jobsites-pool`, `icon-scale`, `table-columns-align`) pass identically with
  and without the diff. Three failures appeared in the wider run and were
  proven pre-existing by stashing the diff and rerunning — two are the known
  spec/code drift over where the Equipment Yard card sits, one is a Settings
  page test. Not introduced here, not fixed here.
- New spec `e2e/tests/jobsites-card-view.spec.ts` pins the shared-derivation
  invariants and the clean-storage default, and was **proven able to fail**:
  red with the feature stashed, green restored.

## Deliberately not done

- **No bulk selection in the sheet.** The list's loose-tool checkboxes and
  "Assign to foreman…" flow stay list-only; the sheet offers the per-tool ⋯
  menu. Selection state is parent-owned and would drag the reserved-space
  discipline into the sheet for a bulk flow the detailed view already serves.
- **No crew mutations from the card view.** Add crew, change truck/trailer and
  move crew stay in the list view — the compact view is for seeing what is
  where, and `CrewCard`'s 23rem rig grid does not fit a 36rem panel anyway.
- **The three pre-existing red specs were left red.** They predate the change
  and belong to the yard-placement drift, which is its own fix with its own
  blast radius.

## Where it is

Committed on `development` together with this entry. Presentation-only:
no new procedures, no custody writes, no schema, no permissions surface.
