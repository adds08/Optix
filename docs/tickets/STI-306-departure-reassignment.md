# STI-306 — Departure reassignment in one auditable action

**Phase:** 3 — Roles, accounts and organisation structure
**Size:** 3 units
**Status:** **DONE** — 2026-08-19. `custody.reassign` permission (owner, equipment_admin,
warehouse), preview + one-transaction move reachable from the clearance queue. Personal
vehicles skipped with the reason shown. Containers route through `applyContainerCustody`, the
sanctioned writer — the first cut used bare UPDATEs and was a second custody writer. Failed QA
once (10 defects) and was reworked. Verified end to end in a browser: 23 tools moved, 23 prior
links closed, 23 complete ledger events, the personal truck left with the leaver, 0
divergences.
**Depends on:** STI-102 (must be atomic first)

---

## Why this exists

`SYSTEM_PLAN.md` §2 and §6.3. When a foreman leaves or is dismissed, their tools,
trailers and *company* trucks are reassigned in one action to their superintendent,
or to the Project Manager where necessary. **Personal vehicles are never reassigned**
— they are not Urban property and leave with the person.

Verified 2026-08-16 — none of this exists:

- No `custody.reassign` permission (`packages/types/src/index.ts:45-82`).
- No reassignment procedure. Grepping for `reassign|departure|offboard` finds only
  prose comments (`custody.ts:12`, `routers/transfer.ts:22`, `schema/asset.ts:101`)
  and one UI dropdown value, `hr_offboarding`
  (`apps/web/components/transfer-form.tsx:129`).
- Termination **only stamps a date** (`routers/project.ts:396-403`). It does not move
  custody and does not deactivate any login.

What does exist is read-only visibility: `dashboard.clearanceQueue`
(`routers/dashboard.ts:106`) and `clearanceCount` (`:53-55,74`), shown at
`apps/web/app/(app)/home/page.tsx:215,319-320`. So the system already tells you a
leaver is holding tools — and offers no way to act on it. The same
visible-but-unactionable pattern as the desk queue.

## Acceptance criteria

1. A `custody.reassign` permission, and a procedure that reassigns **everything** a
   leaver holds in **one transaction**: tools, trailers, and company trucks.
2. **Personal vehicles are skipped.** `vehicle.ownershipType` values are
   `company_owned | personal_allowance` (`packages/db/src/schema/location.ts:58`) —
   **not** the `'company' | 'personal'` the plan's pseudocode assumes. Read the real
   values; a string mismatch here silently reassigns someone's own truck.
3. The successor defaults to the leaver's superintendent, falling back to the Project
   Manager, via `employee.reportsToEmployeeId`
   (`packages/db/src/schema/employee.ts:19`). Where the reporting chain yields
   nobody, the caller **must** choose explicitly — never guess, and never silently
   leave the tools with the leaver.
4. Every item moved writes a ledger event with a **complete** `toState` and a reason
   naming the departure. This is the audit trail the feature exists for.
5. All custody writes go through `packages/api-contracts/src/custody.ts`. Do not add
   a second way to write custody — `CLAUDE.md` calls this the most expensive pattern
   this codebase has paid for.
6. Reachable from the clearance queue at `home/page.tsx:215`, which currently dead-ends.
7. A preview before committing: the operator sees exactly what will move and what
   will be skipped, **and why each personal vehicle is excluded**. A bulk custody
   move with no preview is how a mistake becomes 40 ledger events.
8. Partial failure leaves nothing moved. One transaction, per invariant 3.
9. Tests: personal vehicles skipped; no-successor case raises rather than guessing;
   all-or-nothing on failure.
10. Verified in a browser end to end, with the `assignment` and `transaction` rows
    queried directly afterwards.

## Deliberately out of scope

Deactivating the leaver's login. The plan's pseudocode ends with
`tx.deactivate_user(leaver)`, but user deactivation is STI-303 and there is no
account for most employees anyway. Reassigning custody and closing an account are
separate decisions that should not be welded together in the first version — say so
in the code comment.

## Files

- `packages/api-contracts/src/custody.ts` — the only permitted writer
- `packages/db/src/schema/location.ts:58` — the real ownership values
- `packages/db/src/schema/employee.ts:19` — `reportsToEmployeeId`
- `packages/api-contracts/src/routers/dashboard.ts:53-55,74,106` — clearance queue
- `apps/web/app/(app)/home/page.tsx:215,319-320` — where it becomes reachable
- `packages/api-contracts/src/routers/project.ts:396-403` — termination today
