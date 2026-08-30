# A fourth state nobody had to build twice

Phase 5 of the seven-phase plan tracked in
`/Users/adds08/.claude-personal/plans/imperative-beaming-puzzle.md`: tenant-level
feature presentation. ADR-11 already specified module visibility as a
tenant setting rather than a permission — a binary hide/show list,
`tenant_settings.disabled_modules`, ticketed as STI-1204 and never built.
This phase generalizes it to four states before the binary version is ever
built at all, because the first real consumer — the "AI Import" menu item
from Phase 4 — needed "visible, named, and not yet usable", which a
hide/show list has no way to express.

## What changed

### A table, not a wider column

`tbl_entity_tenant_feature` (`packages/db/src/schema/feature.ts`, migration
`0035_thankful_dazzler.sql`): one row per `(tenant, key)`, a `state` of
`enabled | beta | upcoming | hidden`. A separate table rather than widening
`tenant_settings` further — feature keys grow over time, and a bag of
arbitrary keys on a fixed-shape settings row is neither queryable nor
auditable the way a real table is. No row for a key means `enabled`.

### One router, split the way `settings.ts` already is

`feature.states` is a plain `protectedProcedure` — every signed-in person
needs it to know what their own nav should show, same as `identity.me`'s
permissions. `feature.set` is gated `config.manage`, same as
`settings.update`.

### The filter runs where the permission filter already runs

`applyFeatureStates` (`nav-config.ts`) is a new pure function in the same
spirit as the existing `pinnedItems` — applied in `app-shell.tsx` immediately
after the permission filter, so the rail and the sidebar read one array and
can never disagree about what a group contains. Hidden items are dropped;
beta/upcoming items carry a `featureState` field that `app-sidebar.tsx`'s
`NavRow` turns into a badge, and `upcoming` additionally loses its link
entirely — no click-through, matching what "coming soon" is supposed to mean.

Settings is exempt by group label, not by an id list, in both the filter and
a new shell redirect effect: a module hidden by feature state now redirects
to `/home`, the behaviour ADR-11 already specified for its binary
predecessor. `docs/06-decisions.md` gains ADR-13, recording the
generalization and why it happened before the two-state version was ever
shipped.

The Phase 4 AI Import placeholder now reads the real `import.ai` key instead
of a hardcoded disabled state.

### An admin screen that wasn't originally scoped, and had to be built anyway

`apps/web/app/(app)/settings/modules/page.tsx` — every nav item plus the one
in-page key, a select per row, applying immediately. This wasn't planned as
required for this phase; it became necessary when
`packages/api-contracts/src/reachability.test.ts` (STI-121 — "a task is done
when it is reachable") failed on `feature.set` having no UI caller. That
test's own header rules out "nobody built the screen yet" as a legitimate
exemption reason, so the screen got built rather than the test worked
around.

## What was found while building it

**The sprint ticket this generalizes (STI-1204) already specified its own
seed requirement, almost word for word**: "seed a tenant with at least one
module disabled — a setting no seeded data exercises is a setting nobody
tests." Four rows now seed from a clean database: `import.ai` upcoming (the
state the button ships in), `activity` beta (a real, low-stakes nav row, not
one invented only for the seed), `old-dashboard` hidden — the widget
dashboard `/home` replaced on 2026-08-23, kept only "until this one has been
lived with" per its own comment in `nav-config.ts`, and the safest real
candidate for demonstrating a genuinely disabled module — and
`settings-general` hidden, which proves the one thing that must never
actually work.

**An early throwaway-test locator bug left one harmless row behind.** A
loosely-scoped `div:has-text("Activity")` locator matched the whole Navigation
section rather than one row, and briefly flipped the wrong select — the
`desk` key ended up explicitly `enabled` in the running dev database. Since
`enabled` is already the default for an absent key, nothing observable
changed; noted here so a real row that says nothing different from no row at
all isn't mistaken for something deliberate later.

## Verified

- `pnpm typecheck` clean across `@stinventory/db`, `@stinventory/types`,
  `@stinventory/api-contracts`, `@stinventory/web`.
- New `packages/api-contracts/src/feature-visibility.test.ts` (3 tests)
  proves the ADR-13/STI-1204 acceptance criterion directly: hiding a key via
  `feature.set` has zero effect on what the corresponding router procedure
  (`asset.list`) returns. Full `api-contracts` suite: 257/257 passing.
- New `e2e/tests/nav-feature-flags.spec.ts` (4 tests), committed, against the
  seeded rows: Old Dash disappears from its nav group, a direct `/old-dash`
  URL redirects to `/home`, Settings stays fully reachable despite its own
  seeded hidden row, and Activity opens normally while showing a Beta badge.
  Full e2e suite: 68/68 passing.
- Wrote and ran (then deleted, not committed) throwaway specs confirming the
  Modules settings page itself: all rows render, flipping Activity from beta
  to enabled live-updates the sidebar badge — proving the mutation's cache
  invalidation actually reaches `app-shell.tsx` — and flipping it back
  restored the seed-implied state before finishing.

## Deliberately not done

- **No code path branches on `beta` beyond the badge.** The state exists so a
  feature can be turned on for one tenant without a deploy — the same promise
  ADR-11 made for module visibility — not because anything currently reads it.
- **AI Import stays disabled regardless of state.** There is no AI import
  pipeline built; the badge and disabled attribute are driven by the real
  feature key so the day one exists, flipping the state is real, but nothing
  behind it is built yet.

## Where it is

Branch `development`, uncommitted at the time of writing, on top of Phases
1–4's diff in the same working tree.
