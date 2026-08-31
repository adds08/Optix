# Desk queue screen: approve / verify / decline

**Phase:** 1 — Custody trail
**Size:** 3 units
**Status:** READY
**Blocks:** STI-002
**Depends on:** STI-102 should land first (the procedures it calls must be atomic)

---

## Why this exists

`SYSTEM_PLAN.md` §5 item 1 — "the desk queue is unreachable", and §9 — "a task is
done when it is reachable. A correct procedure with no caller is not delivered."

Verified true on 2026-08-16, and it is the single largest piece of finished backend
work in the repo that delivers nothing. Six procedures exist. **Zero have a UI
caller** in either client:

| Procedure | Defined at | UI callers |
|---|---|---|
| `assignment.approve` | `routers/assignment.ts:156` | none |
| `assignment.decline` | `routers/assignment.ts:202` | none |
| `assignment.return` | `routers/assignment.ts:241` | none |
| `transfer.approve` | `routers/transfer.ts:210` | none |
| `transfer.decline` | `routers/transfer.ts:309` | none |
| `asset.rebuild` | `routers/asset.ts:443` | none |

An exhaustive grep of `apps/web` for `trpc.assignment.*` and `trpc.transfer.*`
returns three hits, all of them reads or creates:
`components/crew-assign-dialog.tsx:68` (`assignment.create`) and
`app/(app)/custody/page.tsx:24-25` (`assignment.list`, `transfer.list`).

Worse, the queue is **visible but unclearable**. `dashboard.pendingApprovals`
(`routers/dashboard.ts:260`) is queried at `app/(app)/home/page.tsx:92`, split into
holds and borrows at `:136-137`, and rendered as read-only rows in an `AttentionCard`
whose `href="/inbox"` (`:229`). But `/inbox` (`app/(app)/inbox/page.tsx:36-47`) wires
only `notification.list`, `inbox.*` and `task.decline`, and the inbox router deals in
`kind: "task" | "message"` (`routers/inbox.ts:31`) — not assignment or transfer rows.
The link is a dead end. Users are shown a count they cannot act on and sent to a
screen that cannot help.

The desk **alert** already works — `notifyDeskPending`
(`packages/api-contracts/src/notify.ts:110`) is wired from `routers/assignment.ts:136`
and `routers/transfer.ts:182`. It currently notifies a desk toward a queue with no
controls.

## Acceptance criteria

1. A desk queue screen lists every pending custody item — both `pending_approval`
   assignments and pending transfers — in one place.
2. Each row has working **approve** and **decline** controls that call the real
   procedures, and the row leaves the queue on success.
3. ~~**Borrow vs held is visible on every row**~~ — **THIS CRITERION WAS WRONG.**

   > **Correction, 2026-08-16.** This ticket was written from
   > `.claude/rules/custody-and-ledger.md`, which carried a stale three-outcome gate
   > table. **The `verify` outcome, the borrow, and the `pending_verification` state
   > were removed on 2026-08-09.** `CustodyOutcome` is now only `"auto" | "approve"`,
   > there is no `transfer.verify` procedure to call, and foremen no longer hold
   > `assignment.create` or `transfer.create`. Urban's desk moves tools; a foreman does
   > not reassign one.
   >
   > The rules file has since been corrected. The implementer was right to build
   > against the code and report the conflict rather than fabricate borrow rows to
   > satisfy this ticket — `CLAUDE.md` says the code wins.

   What survives, and what must be on screen: the **held-versus-applied** semantics. A
   pending row means **nothing has been written yet**, and approval is the second
   signature that commits it. A desk operator must not believe they are confirming
   something that has already happened.

   Dead remnants of the removed model are swept by **STI-111**.
4. **No recipient accept/reject anywhere.** The receiving foreman is never asked to
   accept. Do not add it. (`SYSTEM_PLAN.md` §3 argues this under the old
   "verification model" framing — the conclusion still holds, the framing is stale.)
5. The dead `/inbox` link at `home/page.tsx:229` points at the new screen.
6. The screen is permission-gated, and a user without approval permission does not
   see the controls.
7. `dashboard.pendingApprovals` is invalidated after every action so the home-page
   count is correct. Six existing call sites already do this invalidation
   (e.g. `components/asset-actions.tsx:47`) — follow the pattern.
8. Verified in a real browser at `http://localhost:3100`, with the resulting database
   rows queried directly to confirm what was actually written.

## Approach

Extend `app/(app)/custody/page.tsx`. It already queries `assignment.list` and
`transfer.list` (`:24-25`), so the data is on the page — what is missing is the
actions. That makes this a smaller change than a new route, and it removes the
awkwardness of having two custody screens.

The `custodyOutcome` gate lives in `packages/domain/src/rules.ts:29` and is pure.
Read the 24-line rationale at `rules.ts:4-28` before designing the row — it is the
real documentation for what the desk is deciding.

Note the known caller disagreement recorded in `.claude/rules/custody-and-ledger.md`:
`assignment.approve` and `transfer.approve` disagree on which permission means "can
approve", and the threshold fallback differs between the routers (`?? null`) and
`apply-action.ts` (`?? DEFAULT_HIGH_VALUE_THRESHOLD`). The desk screen will expose
this inconsistency to a user for the first time. Report it; do not silently pick one.

## Files

- `apps/web/app/(app)/custody/page.tsx` — the screen
- `apps/web/app/(app)/home/page.tsx:92,136-137,229` — the count and the dead link
- `packages/api-contracts/src/routers/assignment.ts:156,202,241`
- `packages/api-contracts/src/routers/transfer.ts:210,309`
- `packages/domain/src/rules.ts:4-49` — the gate and its rationale
- `packages/api-contracts/src/notify.ts:110` — the alert that already fires
