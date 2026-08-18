# STI-203 — Carry truck and trailer through custody and `toState`

**Phase:** 2 — Assignment detail
**Size:** 2 units
**Status:** BLOCKED by STI-202
**Depends on:** STI-202

---

## Why this exists

STI-202 adds the columns. This ticket makes them real: a column nothing writes and no
screen captures is not delivered (`SYSTEM_PLAN.md` §9).

## Acceptance criteria

1. `CustodyMove` (`packages/api-contracts/src/custody.ts:18`) carries `truckId` and
   `trailerId`, and `moveCustody` writes them.
2. **Every ledger `toState` on a custody path includes both keys**, explicitly null
   where not recorded. The fold replaces rather than merges — omitting them from the
   snapshot blanks them on the next rebuild, which is the bug that has already
   shipped twice in this codebase.
3. The assign and transfer forms capture truck and trailer:
   - `apps/web/components/assign-form.tsx`
   - `apps/web/components/transfer-form.tsx`
   - `apps/web/components/bulk-move-form.tsx`
   - `apps/web/components/crew-assign-dialog.tsx`
   `apps/web/components/rig-picker.tsx` already has local `truckId`/`trailerId` state
   (`:44,198`) — reuse it rather than building a second picker.
4. Tools-by-jobsite shows holder, truck and trailer against each tool
   (`SYSTEM_PLAN.md` §6.5). The screen is
   `apps/web/app/(app)/jobsites/page.tsx`.
5. The tool detail screen shows the current truck and trailer.
6. Selecting a trailer that is not a trailer, or a truck that is not a truck, is
   rejected with a typed error the UI can render.
7. Verified in a real browser, with the resulting `assignment` row **and** the
   `transaction.to_state` queried directly to confirm both were written.

## Watch for

`projectForCustodian` (`custody.ts:88`) defaults the project to the recipient's
primary project, because tools follow the person, not the site. Truck and trailer
have **no** equivalent default and must not acquire one — a tool does not inherit the
truck of whoever receives it. If a form makes them feel like they should default,
that is a sign the form is wrong, not the rule.

## Files

- `packages/api-contracts/src/custody.ts:18,59`
- `packages/api-contracts/src/routers/assignment.ts`, `routers/transfer.ts`
- `apps/web/components/rig-picker.tsx:44,198`
- `apps/web/app/(app)/jobsites/page.tsx`
- `apps/web/app/(app)/tools/[id]/page.tsx`
