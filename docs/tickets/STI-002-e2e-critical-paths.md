# STI-002 — E2E specs for the custody critical paths

**Phase:** cross-cutting
**Size:** 2 units
**Status:** BLOCKED by STI-001, STI-105
**Depends on:** STI-001 (harness), STI-105 (the desk queue must exist first)

---

## Why this exists

Release 1's central claim is reachability. `SYSTEM_PLAN.md` §9: *a task is done when
it is reachable.* These specs are what stops the desk queue silently becoming
unreachable again after the next refactor — which is exactly how it got that way.

## Acceptance criteria

Each journey runs in a browser, and **each asserts against the database as well as
the screen.** A green screen is a claim; the row is the evidence. This is an
event-sourced system, so assert on the `transaction` row too, not only the
projection.

1. **Issue a tool.** Assign a tool to a foreman → the register shows the new holder →
   one active `assignment` row → a `transaction` row with a **complete** `to_state`.
2. **Desk queue approve.** A pending item appears in the queue → approve → it leaves
   the queue, the projection updates, the ledger gains an event, and
   `dashboard.pendingApprovals` decreases.
3. **Desk queue decline.** Same, and assert custody did **not** move.
4. **Borrow versus permanent.** A `verify` item and an `approve` item are visibly
   different in the queue, and the borrow leaves the permanent owner untouched.
   This is the distinction a desk operator can most expensively get wrong
   (`.claude/rules/custody-and-ledger.md`).
5. **Transfer between foremen.** After the transfer exactly one active assignment
   exists — the duplicate-custody bug, pinned as a test rather than a comment.
6. **The projection matches the fold** after every journey above. Reuse the STI-106
   checker rather than reimplementing the comparison.
7. **Permission denial.** A user without approval permission cannot see or invoke the
   approve control. Blocked by the accounts problem — see below.

## Known blocker on criterion 7

Only three login accounts exist — `owner`, `admin` (equipment_admin) and `warehouse`
(`packages/db/src/seed-data.ts:2485`). There is no foreman, superintendent or PM
login, so a genuine negative permission test cannot be written yet. That is STI-304.

Do **not** work around it by faking a session or stubbing permissions in the test —
that would assert the mock, not the system. Write the spec, mark it skipped with a
reference to STI-304, and say so in the report.

## Deliberately not covered

Chat and intent journeys. `packages/intent` has 40 unit tests already, the surface is
non-deterministic, and Release 1's scope is the desk. Adding flaky specs to a young
harness is how teams learn to ignore a red build.

## Files

- `e2e/` — from STI-001
- `apps/web/app/(app)/custody/page.tsx` — the desk queue from STI-105
- `packages/db/src/seed-data.ts:2485` — the three accounts
