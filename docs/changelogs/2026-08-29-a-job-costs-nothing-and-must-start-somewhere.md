# A job costs nothing and must start somewhere

Phase 1 of a seven-phase request touching jobs/projects, the table component,
tenant feature flags and the sidebar. This phase is the project schema itself:
`cost_center` was a column nobody had ever asked about and nobody could
explain, the four-value status enum had no room for a job that stalled or
fell through, and a job could be created with no start date at all. The
remaining six phases (table UX, code fields, tenant feature flags, page
headers, sidebar identity) are tracked in
`/Users/adds08/.claude-personal/plans/imperative-beaming-puzzle.md` and are
not part of this entry.

## What changed

### `cost_center` is gone

`project.costCenter` was a free-text field, always null in the seed, read by
nothing downstream — no report, no gate, no screen switched on it. Dropped
from the schema, the router's `list`/`create`/`update`, the import spec, the
seed, and the form. Two migrations rather than one:
`0032_aromatic_blacklash.sql` adds `description` and tightens `start_date`
and the `status` default; `0033_flippant_jigsaw.sql` drops `cost_center`
alone. Doing both in one `drizzle-kit generate` call makes it ask whether
`cost_center` was *renamed to* `description` — a fair guess from the diff,
and the wrong one — so the add and the drop were generated as two separate,
unambiguous steps instead of answered through an interactive prompt.

`department` (`docs/built/11-department-cost-targets.md`) was written
specifically to explain why it isn't `cost_center` and doesn't collide with
`project.costCenter`. That reasoning is now about a column that no longer
exists; both the doc and the schema comment on `department` are corrected to
say so rather than left arguing with a field that's gone.

### The status enum grows from four states to six

`awarded | active | closing | complete` becomes
`not_awarded | awarded | in_progress | completed | cancelled | on_hold`.
`closing` had no real distinction from `active` that any screen ever read, so
existing `closing` rows fold into `in_progress` along with `active` ones;
`complete` becomes `completed`. The completion guard in `project.update` —
refusing to close a job while tools are still checked out against it — now
gates on `"completed"` and is otherwise unchanged; STI-105's original test
suite still passes against the renamed value.

New default on `create` is `not_awarded`, not `active` — a job starts as a
line item you're bidding on, not as work already underway.

### `name` and `startDate` are required; `description` is new

`startDate` moved from optional to `NOT NULL` at the schema level, matching
`name`, which has been required since the table was created. `description`
is a new optional text column, exposed on the form and in `project.list`,
with a project detail page still to come (see below).

## What was found while building it

**A UI comparison had drifted from what it names.** `p.status !== "active"`
in `apps/web/components/sti/monitor/project-monitor.tsx` decides whether an
empty job still gets a board on the wall monitor. `"active"` stopped being a
valid project status the moment the enum changed; left alone, every board
with no tools currently on it would have silently stopped rendering,
regardless of whether the job was actually in progress. Caught by grepping
for status string comparisons after the schema change, not by a test — there
isn't one covering this path. Fixed to `"in_progress"`.

**The import spec's `externalId` column was labelled `cost_code`.** A holdover
from the original design, and confusing now that `costCenter` is gone: the
CSV header implied a cost accounting field when the column is the project's
own code, shown in the register as an id. Renamed to `project_code`.

**`StatusPill`'s tone table is shared across every status column in the
product** (asset, assignment, transfer, message, project — one map). The
three new project-only values (`not_awarded`, `awarded`, `on_hold`) had no
entry and would have rendered with the generic idle fallback; given tones
that actually distinguish them (idle, info, warn respectively).

## Verified

- `pnpm typecheck` clean across `@stinventory/db`, `@stinventory/types`,
  `@stinventory/api-contracts`, `@stinventory/web`.
- `packages/api-contracts` suite: 254/254 passing, including
  `project-lifecycle.test.ts` (the STI-105 completion-guard tests, renamed to
  the new status values) and `import-commit.test.ts` (the project import
  fixtures, updated for the required `start_date` and the renamed CSV
  header).
- `packages/domain` suite: 32/32 passing (untouched by this change; run for
  confidence, not because anything here should have moved it).
- Migrations applied with `make migrate`; existing seeded rows backfilled by
  hand (`active`/`closing` → `in_progress`, `complete` → `completed`) since
  the migration itself only changes shape, not data.
- Reseeded from scratch (`SEED_RESET=1`) and confirmed all six statuses are
  reachable from a clean database: Bell is seeded `on_hold`, Little Elm
  `cancelled`, Mesquite `completed`, City of Kemp `awarded`, the rest
  `in_progress`. `not_awarded` is the create-form default and wasn't given a
  seeded row of its own — it needs no fixture to be reachable.
- Did **not** verify the web form or table in a browser this phase — typecheck
  and the API test suite cover the contract; the actual screens are exercised
  in the phase that changes their layout (Phase 3).

## Deliberately not done

- **No project detail page yet.** `description` and `siteAddress` are now on
  the router and the form, but
  `apps/web/app/(app)/projects/[id]/page.tsx` doesn't exist — there's nowhere
  to see them beyond the edit dialog. Tracked as the next piece of this same
  phase, not a separate one.
- **No map or geocoding.** Explicitly future work per the original request;
  this phase only makes sure the field the map would key off (`siteAddress`)
  is there.
- **Table headers on `/projects` still say "Job"/"Job ID".** That's a
  terminology decision (stay on "Project", not rename to "Job") bundled with
  the code-field work in a later phase — touching it here would mean editing
  the same lines twice.
- **No docs/archive/ or design/ fixes.** Both still say `cost_center` in a
  couple of places; both are explicitly frozen historical snapshots, not live
  documentation, so they're left as they were.

## Where it is

Branch `development`, uncommitted at the time of writing — this entry lands
alongside the rest of Phase 1's diff, not as a separate commit.
