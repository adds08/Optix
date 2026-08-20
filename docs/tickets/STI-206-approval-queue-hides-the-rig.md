# STI-206 — The desk approves a transfer without seeing which truck it is signing off

**Phase:** 2 — Assignment detail (follow-up)
**Size:** 1 unit
**Status:** **DONE** — 2026-08-19. `dashboard.pendingApprovals`, `transfer.list` and
`assignment.list` now carry the rig; the queue shows a "Rides in" column matching the
jobsite table's phrasing. Nothing recorded renders as an EMPTY cell, never a dash. The
seeded pending assignment carries the personal-allowance truck so the ownership marker is
reachable from a clean database.
**Found by:** the STI-203 implementer on 2026-08-18, disclosed as "a natural follow-up".
Raised here as more than that, for the reason below.

---

## Why this exists

STI-203 made the transfer form capture a truck and trailer, and migration `0017` parks
them on the `transfer` row so a held transfer keeps the pick through approval. That half
works and is verified end to end.

**But `transfer.list` — the query behind the Approval queue at `/custody?tab=queue` — does
not surface `to_truck_id` / `to_trailer_id`.** So the desk sees who the tool is going to and
which project, approves, and only then does the vehicle context enter the record.

## Why this is not merely cosmetic

The high-value gate exists so that a **second person consents** to a movement. Consent to a
movement you cannot fully see is weaker than it looks, and the vehicle is not incidental
detail — `SYSTEM_PLAN.md` §1 names *"which trailer is it in"* as one of the questions the
system exists to answer, and invariant 5 exists because truck and trailer are part of "full
context".

Concretely, the desk cannot currently catch:

- a tool routed into a trailer that is already on its way to a different jobsite
- a personal-allowance truck being used where company property is expected — the
  distinction `vehicle.ownershipType` exists to record, and the one that drives the Phase 3
  departure path
- two tools in the same request going to different rigs, which is legitimate but worth
  seeing before signing

None of that is a correctness bug. All of it is the desk being asked to sign blind, on the
one path where a signature is the entire point.

## Acceptance criteria

1. `transfer.list` (and whatever feeds `dashboard.pendingApprovals` for the queue) returns
   the parked truck and trailer, joined to `vehicle` for the display unit — **tenant-scoped
   on the join**, because the composite FK is tenant-blind and will not catch a mistake here.
2. The Approval queue row shows the rig alongside custodian and project. Match the phrasing
   already used elsewhere — the jobsite table says **"Rides in:"** — rather than inventing a
   third vocabulary for the same fact.
3. **Distinguish "no vehicle recorded" from "not shown".** A blank cell reads as "no truck",
   and after STI-202's three-state rule that is a claim, not an absence. Say nothing where
   nothing was recorded, and make sure it does not look like a loading state.
4. Check the assignment side too: `assignment.list` feeds the same queue for pending
   assignments and has the same gap. Fix both or state why only one.
5. Verified in a browser against the seeded pending rows — TOOL-0142's transfer carries
   trailer TE-017 and no truck, which is exactly the mixed case criterion 3 is about.
6. No new procedure. This is a projection of columns that already exist; adding a second
   read path for the same data would be the wrong shape.

## Out of scope

Do **not** add the rig to the approve/decline *mutations* — they already carry it correctly
through `moveCustody` (STI-203, verified). This ticket is read-side only.

## Related

- **STI-203** — captured the rig and carried it through approval.
- **STI-202** — the three-state snapshot rule that makes criterion 3 matter.

## Files

- `packages/api-contracts/src/routers/transfer.ts` — `list`
- `packages/api-contracts/src/routers/assignment.ts` — `list`
- `packages/api-contracts/src/routers/dashboard.ts` — `pendingApprovals`, what the queue reads
- `apps/web/app/(app)/custody/page.tsx` — the queue tab
- `apps/web/components/jobsite-tool-table.tsx` — the existing "Rides in:" phrasing to match
