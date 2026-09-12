# The HR Flag gets a shortcut to Terminated, not a second way there

The People screen has carried an "HR Flag" column since the BambooHR sync landed
— `Reported left <date>` when `hrFlaggedInactiveAt` is set — with nothing attached
to it. Acting on it meant opening "Edit details" and changing Status by hand. The
sync itself was never going to do this automatically: the user settled on
2026-09-07 that a departure is a flag for a person to act on, never an automatic
write, because terminating someone also reaches tool custody and the clearance
queue. That reasoning was reaffirmed this session, not revisited — what was
missing was a fast way to *act* on the flag, not a faster way to skip it.

## What changed

### One row action, reusing the existing write

`apps/web/app/(app)/people/page.tsx` gains a "Mark as Terminated" row action,
visible only when `hrFlaggedInactiveAt` is set and `employmentStatus` isn't
already `terminated`. It calls `employee.update` with
`{ id, employmentStatus: "terminated" }` — the exact mutation "Edit details"
already sends, which stamps `terminatedAt` for the clearance queue
(`packages/api-contracts/src/routers/project.ts`). No new backend procedure, no
schema change, no migration.

It does not touch login. `employee.update` only deactivates a login when Status
is set to `inactive`, not `terminated` — that distinction already existed and
this change doesn't blur it. "Deactivate login" stays its own row action.

No confirmation step was added, matching "Deactivate login" right next to it in
the same menu, which has never had one either — both are reversible the same
way (setting Status back to Active clears `terminatedAt`; reactivating a login
is one click), so a bespoke confirm dialog for only this one action would have
been new surface for a single caller.

## What was found while building it

The BambooHR org-chart CSV the user was comparing against the register
(`docs/bamboohr_org_chart_for_visio.csv`) and the sync's own `terminated` signal
(`employmentStatus` from BambooHR, carried as `hrFlaggedInactiveAt`) are two
different facts — a name missing from an export is not the same claim as
BambooHR stating a person left. The user chose the sync's own signal as the
target for this action once that distinction was named.

Locally, nobody was flagged and nobody had a `reportsToEmployeeId`
set — the urban dataset has never had the BambooHR sync run against it, so this
path had never been exercised end to end before now.

## Verified

Flagged a real employee (Bill Taylor) directly in Postgres to exercise the path,
signed in as the tenant's owner account in a real browser, and confirmed:

- The action appears only on Bill Taylor's row, not on an unflagged row.
- Clicking it changes the Status pill from `ACTIVE` to `TERMINATED` and the
  action disappears from that row's menu afterward.
- `select employment_status, terminated_at, hr_flagged_inactive_at from
  tbl_entity_employee where name = 'Bill Taylor'` showed `terminated`,
  a real timestamp, and the flag untouched — confirming the two facts stay
  independent.

Test data was reverted afterward (`hr_flagged_inactive_at`, `employment_status`
and `terminated_at` all restored to their prior values).

`pnpm typecheck` passes across the monorepo.

## Deliberately not done

- **No change to `apps/api/src/bamboo-sync.ts` or the "observed, never written"
  policy in `packages/domain/src/bamboohr.ts`.** Reaffirmed this session: a
  departure stays a flag for a person to act on.
- **No confirmation dialog.** See above — matched the sibling action instead of
  adding a one-off pattern.
- **No login deactivation bundled in.** Stays a separate, deliberate action.

## Where it is

Uncommitted in the working tree (`apps/web/app/(app)/people/page.tsx`), on
`development`. Not deployed.
