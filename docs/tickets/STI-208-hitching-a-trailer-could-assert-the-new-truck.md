# STI-208 — Hitching a trailer carries forward a stale truck instead of asserting the new one

**Phase:** 2 — Assignment detail (follow-up)
**Size:** 1 unit
**Status:** READY — but read "Decide before building" first; the answer may be "no"
**Found by:** the STI-203 implementer on 2026-08-18, offered as enrichment rather than a
defect. That framing is correct and this ticket keeps it.

---

## Why this exists

STI-203 made `applyContainerCustody` carry the recorded rig forward rather than erasing it —
a hand-over changes *who holds the tool*, not *what it rides in*, so the writer asserts
nothing new and copies the newest snapshot's vehicle keys verbatim.

That is the honest floor, and for the `location.setCustodian` path it is exactly right.

**But the same function is also reached from `vehicle.update { attachedToVehicleId }` — a
trailer being hitched to a truck.** On that path the new truck is in scope (`truck.id`), and
the carried-forward `truckId` is stale from the moment of hitching: it is whatever the tool
last recorded, which may be an old truck or an explicit null.

So after hitching TE-006 to Truck 12, every tool aboard TE-006 still records "no truck" or
"Truck 7". Not wrong in the sense of a false assertion — the writer never claimed to know —
but less true than the code could easily be.

## Decide before building — the answer may legitimately be "leave it"

The real question is not whether the code *can* assert the new truck. It is whether
**hitching a trailer should rewrite the recorded truck of every tool aboard it.**

Arguments for asserting it:

- It is the truth at that moment. The tools are in that trailer; that trailer is now behind
  that truck.
- "Which truck is this tool in" is one of the questions `SYSTEM_PLAN.md` §1 names, and
  answering "not recorded" when the system demonstrably knows is a weak answer.

Arguments against:

- `assignment.truckId` was designed as **the truck the custody move recorded** — a fact about
  a hand-off, not a live tracking field. Rewriting it on every hitch turns a historical
  record into a running state, which is a different thing from what STI-201 decided.
- A trailer may be hitched and unhitched repeatedly between custody moves, so each hitch
  would append ledger events for tools nobody touched — noise in an append-only log that can
  never be pruned.
- Unhitching has no obvious counterpart: does the truck become null, and is that
  "affirmatively no truck" or "not recorded"? STI-202's three-state rule makes that question
  sharp, and there is no good answer if hitching writes the field.

**That last point is the strongest, and it may settle the ticket as "no".** If you conclude
carry-forward is correct, close this having written the reasoning into
`.claude/rules/custody-and-ledger.md` — a recorded "we considered this and chose not to" is
worth as much as a change, and stops it being re-raised.

## Acceptance criteria

1. A recorded decision, with reasoning, in the rules file next to the carry-forward bucket.
2. **If asserting:** only the `vehicle.update { attachedToVehicleId }` call site changes;
   `location.setCustodian` keeps carrying forward. Both keys stay explicit. Unhitching has a
   defined, documented behaviour. A test covering hitch → aboard tools record the new truck,
   and unhitch → whatever you decided.
3. **If not asserting:** no code change, and the comment at the call site explains why the
   stale value is deliberate, so the next reader does not "fix" it.
4. Either way, the STI-203 tests stay green — carry-forward on the hand-over path must not
   regress.

## Explicitly out of scope

The `contents` query's location-versus-assignment tension is **STI-207**. Do not fold them
together; they touch the same function but are different questions, and STI-207 may change
which tools this ticket would even apply to.

## Related

- **STI-203** — introduced carry-forward and drew the line at the honest floor.
- **STI-201** — decided what these columns are for, which is the crux here.
- **STI-207** — the other open question in the same function.

## Files

- `packages/api-contracts/src/routers/location.ts` — `applyContainerCustody` and the
  `vehicle.update` hitch call site
- `.claude/rules/custody-and-ledger.md` — where the decision belongs
