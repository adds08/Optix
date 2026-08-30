# STI-111 — Remove the dead `pending_verification` remnants

**Phase:** 1 — Custody trail
**Size:** 1 unit
**Status:** READY
**Depends on:** STI-105 (in QA)

---

## Why this exists

Found by the STI-105 developer and confirmed directly on 2026-08-16.

The `verify` outcome, the borrow, and the `pending_verification` transfer state were
**removed on 2026-08-09** (`packages/domain/src/rules.ts`, whose 24-line rationale
explains that Urban's desk moves tools and foremen do not reassign them). Foremen no
longer hold `assignment.create` or `transfer.create` at all.

The backend removal was done properly. The **remnants were not swept**, and they are
not inert — they produce a permanently empty card in the product:

| Location | What it does now |
|---|---|
| `apps/web/app/(app)/home/page.tsx:137` | `borrows` filters on `pending_verification` — **always empty**, feeding a "Loans to verify" card that can never show anything |
| `packages/api-contracts/src/routers/dashboard.ts:300,354` | `pendingApprovals` still queries `pending_verification` |
| `apps/api/src/rest-routes.ts:121` | same query on the REST surface |
| `apps/web/components/sti/status.tsx:47`, `apps/mobile/components/ui.tsx:51` | status badge styling for a status no row can hold |
| `packages/types/src/index.ts:164` | the status remains in the enum |

Live database: **zero rows** in any `pending_verification` status.

## Why it is worth a unit

A card that is permanently empty teaches users the screen is broken, and teaches the
next developer that the feature exists. It already cost this project real time: the
stale three-outcome table in `.claude/rules/custody-and-ledger.md` caused ticket
STI-105 to specify a "borrow vs held" control for a state that cannot occur. That rule
file is now fixed; these remnants are the rest of the sweep.

## Acceptance criteria

1. The "Loans to verify" card is removed from `home/page.tsx`, along with the `borrows`
   filter that can never match.
2. `dashboard.pendingApprovals` and the REST route query only `pending_approval`.
   **Check the counts they feed** — `pendingApprovals` is what the new desk queue reads
   (STI-105), so a change here moves a live surface. Verify the queue still shows the
   right rows.
3. **Decide deliberately whether `pending_verification` leaves the status enum**, and
   record the reasoning. If any historical `transfer` row could still carry it, the
   enum entry and its badge styling must stay so history renders — removing them would
   break the display of past records. Confirm against the database rather than
   assuming; the live count is currently zero, but production may differ.
4. If the enum entry stays, it carries a comment saying it is **historical only** and
   that no writer may produce it.
5. `apps/mobile` badge styling handled consistently with whatever criterion 3 decides.
6. No new empty-state UI invented to replace the card. Removing it is the fix.
7. Verified in a browser: the home dashboard no longer shows a card that cannot fill,
   and the desk queue still lists pending items correctly.

## Also sweep

`docs/workings/SYSTEM_PLAN.md:220` still describes the Phase 1 task as
"approve / verify / decline, borrow vs held distinction visible". `SYSTEM_PLAN.md` §3
still describes the verification model as live behaviour. Both are wrong. Per
`CLAUDE.md`, when a doc and the code disagree the code wins and the doc is fixed in the
same change.

`.claude/rules/custody-and-ledger.md` was already corrected on 2026-08-16 — do not
re-edit it, but read it for the accurate description.

## Files

See the table above, plus `SYSTEM_PLAN.md` §3 and `docs/workings/SYSTEM_PLAN.md:220`.
