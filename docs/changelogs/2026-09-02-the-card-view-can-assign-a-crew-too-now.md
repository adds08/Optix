# The card view can assign a crew too, not just look at one

Direct feedback: the Cards view showed tools and nothing about who runs a job
or how it's rigged, and there was no way to add a crew, a PM or a
superintendent without switching back to the list — "where is the PM,
superintendent? how do we assign truck and trailer?" The list already
answers all of this. The card view didn't.

## What changed

### The card face names who runs it, and how rigged the job is

Each job card now carries a line between its name and its tool count: the
PM and superintendent by name (from the same `projectTeam.all` roster the
list's `JobsiteTeamStrip` reads), and an `N/M rigged` count that goes warn-
toned once any crew is short a truck or trailer — the same signal the list's
`RIGGED n/N` metric already gives, in one line instead of a three-line bar.
Plain text, deliberately: the whole card is a `<button>` that opens the
sheet, and nesting `JobsiteTeamStrip`'s own add/remove controls inside
another interactive element is invalid HTML that breaks click handling
either way.

### The sheet is where the real controls live

`JobsiteTeamStrip` — the actual, editable roster strip, add and remove
included — now renders in the sheet header, where it isn't nested inside
anything. An "Add crew" button sits beside the title (never inside it —
`SheetTitle` feeds the panel's accessible name, and a button's text riding
along would turn it into "NEX 22017 Add crew"), opening the same
page-level `RigPicker` the list's own "Add crew" opens. Nothing new was
built for either: both are the existing dialogs, rendered once at the page
level, now reachable from a second place.

### Crew rows in the sheet are `CrewCard`, not a second implementation

The sheet's per-crew sections used to be a hand-rolled `<section>` showing
just a name and a rig summary — read-only. They're `CrewCard` now, in a new
`compact` mode, wired with the exact same `onPick`/`onAddTools` calls and
`DropdownMenu` items (`Change truck`, `Change hitched trailer`, `Move this
crew to another job`, `Add tools to this crew`) the list's crew rows use.
Same reasoning as `ToolTable`'s own `compact` prop, added for the same
class of problem: `CrewCard`'s ordinary layout has a fixed `w-[23rem]`
three-track grid for the truck→hitch→trailer chain, deliberate for lining
up a dense list of rows — and exactly the kind of fixed width that doesn't
fit a ~32rem sheet. Compact swaps the grid for a flex-wrap group and passes
`compact` down into its own internal `ToolTable`, so nesting a crew's tool
table inside a crew inside a sheet doesn't reintroduce the horizontal-scroll
bug from two commits ago. Nothing about *what a crew row can do* changed —
only how it's laid out.

### A collision found by the person using it, not by a spec

The first version put "Add crew" flush right (`ml-auto`) in the header row.
`SheetContent`'s own close ✕ is `absolute top-4 right-4` — outside that
row's layout entirely — so the button drifted straight underneath it. Fixed
with `pr-8` reserving the close button's footprint on that row, the same
"leave room for what floats independently" fix the shell wrapper already
needed once for the assistant panel.

## Verified

- New spec, `jobsites-card-actions.spec.ts`, against the seeded demo data
  (Lone Star, seeded with a PM and a superintendent): the card face names at
  least one of them and shows an `N/M rigged` line; opening the sheet shows
  the real team-strip chips (`PM-001 · Dana Whitmore`,
  `SUP-001 · Marcus Whitfield` — matched by the strip's own chip text, not
  the bare name, because a superintendent can also hold tools as a crew
  foreman since `CUSTODIAN_ROLES` widened, so "Marcus Whitfield" alone
  matches twice on this exact sheet); a crew's ⋯ menu opens with `Change
  truck`/`Assign truck` and `Move this crew to another job` present; "Add
  crew" reaches a real dialog.
- **Proven able to fail**: stashing the three feature files (keeping the new
  spec) turns both new tests red — the PM/Super line and the sheet's actions
  are both genuinely absent without the change, not vacuously passing.
- Deliberately read-only, like every spec in this suite: pickers are opened
  and closed with Escape, never completed — `playwright.config.ts`'s own
  isolation note says a mutating spec needs an isolation mechanism this repo
  doesn't have yet, and this change doesn't need one to prove reachability.
- The other jobsites/table specs (`jobsites-card-view`,
  `jobsites-search-narrows`, `no-layout-shift`, `table-columns-align`) pass
  unchanged — 17 of 17 across the full jobsites/table set.
- `pnpm typecheck` and lint clean; `turbo run test` green across all eight
  packages.
- The close-button collision was reported directly against the running app
  and fixed in the same pass, then re-verified against the full spec set
  above.

## Deliberately not done

- **No mutation was completed by an automated check.** Every picker opened
  in the new spec is closed with Escape. Confirming an actual crew
  assignment or rig change writes correctly is a manual or future
  isolated-spec exercise, not this one.
- **`CrewCard`'s ordinary (non-compact) layout is untouched** — verified by
  `git diff` showing zero removed lines in that branch. The list view's
  crew rows render exactly the JSX they did before this change.

## Where it is

Committed on `development`, immediately following the search fix and the
scroll/preview fix in the same session. `apps/web/components/jobsite-crew-card.tsx`
gains the `compact` prop; `jobsite-card-view.tsx` and the page wiring gain
everything else.
