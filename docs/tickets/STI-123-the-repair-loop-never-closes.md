# STI-123 — The repair loop never closes: `repair_complete` has no writer

**Phase:** 1 — Custody trail (follow-up)
**Size:** 2 units (a writer, an affordance, and the decision about who signs it off)
**Status:** READY
**Opened:** 2026-08-31
**Found by:** a production notification the owner could not explain — pulling the thread
from "Not approved: Repair requested: UIC-1008" through `approveTaskAction` into
`apply-action.ts`, while fixing the unrelated notification-recipient bug.

---

## Why this exists

A tool goes into the shop through a properly gated path, and comes out through nothing.

Approving a repair request runs the `repair` case in `apply-action.ts` — it closes active
custody, sets `current_status = 'in_maintenance'`, nulls the vehicle keys because a tool in
the shop is not riding anyone's rig, and emits a `repair_start` event. That half is built,
tested and correctly permissioned: `repair` maps to `asset.manage` in the intent catalog,
and `approveTaskAction` charges that permission **against the approver**, which is the point
of the gate.

`repair_complete` exists as an event type in `packages/types` and has a colour in the tool
detail timeline. **Nothing anywhere writes it.** Grep the tree: `packages/types` declares it,
`apps/web/app/(app)/tools/[id]/page.tsx` styles it, and there is no third reference.

So the only way a tool leaves `in_maintenance` is somebody picking a different status off
the tool menu. That is a status edit. It records that the register changed, not that the
repair happened, who did it, what it cost, or whether the tool is actually fit to issue
again. The ledger — the system of record — has a `repair_start` with no matching end, for
every tool that has ever been to the shop.

## Why this matters more than it looks

The product's central claim is that where a tool is, and what has happened to it, is
*calculated* from an append-only ledger. A one-sided event breaks that claim in a specific
way: fold the ledger for a repaired tool and the last thing it says is "sent for repair",
however many months ago the tool came back. The projection says `available` because someone
typed it; the ledger says the tool is in the shop. Neither is wrong about its own job, and
they disagree about the world. That is the same shape as the STI-207 container bug — no
error, no divergence raised, both stores internally consistent and both wrong — which is
the class this codebase has already paid for twice.

There is also no way to answer "how long do repairs take" or "what have we spent on this
grinder", because nothing marks the end of one.

## What has to be decided, not just built

**Who signs off that a repair is done.** This is the real content of the ticket and it is
not obviously `asset.manage`. Candidates, with the argument for each:

- **The mechanic who did the work.** They know it is done. But "the person who did the work
  certifies the work" is the arrangement the approve/decline gate exists to avoid elsewhere.
- **The equipment desk (`asset.manage`).** Symmetric with the approve side, and the desk is
  who re-issues the tool. Means the desk signs off work it did not see.
- **Both, as two steps** — the mechanic reports complete, the desk accepts it back into
  circulation. Honest, and the only option that produces a real "fit to issue" moment. Also
  the most build.

Do not pick one in the implementation. Ask Urban how the shop actually hands a tool back;
this is a question about their yard, not about the schema. The **third option is the one to
put to them first**, because it is the only one that distinguishes "repaired" from
"available", and that distinction is what a foreman is actually asking about.

## Acceptance criteria

1. A `repair_complete` writer exists, emitting a **complete `toState`** — every base key,
   with vehicle keys handled per the writer buckets in `.claude/rules/custody-and-ledger.md`.
   A tool coming back from the shop asserts nothing about a truck, so it is bucket 3
   (four-key, absent vehicle keys) unless the sign-off flow genuinely re-issues it.
2. The permission is whatever question 1 above resolves to, charged against whoever signs
   off, and stated in a comment naming why that actor and not the other two.
3. A screen can reach it. `repair_start` is reachable through chat and the inbox; a
   completion nobody can click is this ticket again in six months.
4. The tool timeline renders the pair. The colour is already there.
5. Tests: the fold over `repair_start` → `repair_complete` returns the post-repair state,
   and a `repair_start` with no completion still folds to `in_maintenance` — the existing
   history must keep reading correctly.
6. **Seed something that reaches it**, per CLAUDE.md rule 9 — including a tool still in the
   shop, so both sides of the fold are exercisable from a clean database.
7. Decide explicitly what happens to the tools already carrying an unterminated
   `repair_start` in production. Backfilling a completion nobody witnessed is inventing
   history; leaving them is a permanent asterisk. Either is defensible, neither silently.

## Deliberately out of scope

- **Repair cost, vendor and downtime reporting.** They all want this event to exist first.
  Build the event, then decide whether the reporting is wanted.
- **Scheduled/preventive maintenance.** `dashboard.kpis` returns a hardcoded
  `scheduledMaint: 0`; that is a different feature and its own ticket.

## Files

- `packages/api-contracts/src/apply-action.ts` — the `repair` case, and where its sibling goes
- `packages/types/src/index.ts` — `repair_complete`, already declared
- `packages/intent/src/catalog.ts` — the `repair` intent and its permission
- `apps/web/app/(app)/tools/[id]/page.tsx` — the timeline that already has the colour
- `packages/domain/src/fold.ts` — and `fold.test.ts` for criterion 5
