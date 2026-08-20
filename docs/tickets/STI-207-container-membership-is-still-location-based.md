# STI-207 — Container membership is location-based, but the truth moved to the assignment

**Phase:** 2 — Assignment detail (follow-up)
**Size:** 2 units
**Status:** READY
**Found by:** the STI-203 implementer on 2026-08-18, while fixing the container writer.
Reported rather than fixed, correctly — it is a model question, not a bug in that fix.

---

## Why this exists

`applyContainerCustody` decides which tools are aboard a container by **location**:

```
contents  ←  asset.current_location_id = <the container's location row>
```

That was the only signal available before STI-202. It no longer is. A tool now records
which trailer it rode in on `assignment.trailerId`, and after STI-203 that is the field the
product reads — `asset.list` joins the active assignment, and both "Rides in" on the jobsite
table and Truck/Trailer on tool detail come from there.

So there are now **two answers to "is this tool aboard TE-006"**, and only one of them drives
custody moves.

## What actually breaks, and when

**Nothing today.** Seeded rows carry both — every seeded assignment has a trailer *location
row* and a `trailerId` — so the two signals agree and hand-overs work.

It becomes real the first time a tool is assigned **the model-correct way**: `trailerId` set
to TE-006, `locationId` left blank or pointing at a yard. STI-202's schema comment says
exactly that shape is intended — vehicles go in the two columns, `locationId` carries
non-vehicle places. Such a tool is aboard TE-006 by the assignment and **not** aboard by the
location, so handing TE-006 to another foreman silently leaves its custody behind.

The tool then shows "Rides in: TE-006" while being held by whoever had it before the
hand-over. No error, no divergence — the projection and ledger agree with each other and
both are wrong about the world.

**This is a gap STI-203 created**, not a pre-existing one. Before that ticket there was only
one signal. Say so in whatever fixes it, so the next reader understands why a design that
was coherent became incoherent.

## The decision this ticket exists to make

Do not start by writing a query. Decide what "aboard" means now:

- **Assignment columns are the truth**, and `location` for a vehicle becomes a legacy signal
  to migrate off. Cleanest model, largest blast radius — `location.setCustodian`, the vehicle
  editor, `rig-picker`'s container model, and any report reading vehicle locations.
- **Both count**, unioned, until the location signal is retired. Safest, and honest about a
  transitional period — but two sources of truth is what created this.
- **Location stays the truth for containment**, and the assignment columns record *history*
  only. Defensible, but it contradicts STI-202's schema comment and makes "Rides in" a
  statement about the past, which is not how it reads on screen.

Whatever you choose, write it where the next reader will find it — `.claude/rules/custody-and-ledger.md`, and a comment at `applyContainerCustody`.

## Acceptance criteria

1. A recorded decision on what "aboard" means, with the reasoning, in the rules file.
2. `applyContainerCustody` implements it. If the answer is a union, it must not double-move a
   tool that satisfies both signals.
3. A test for the case that fails today: a tool with `trailerId` set and a non-vehicle
   `locationId`, whose trailer is handed over. Under the chosen model, assert what should
   happen — and if the answer is "it moves", prove it moves and carries its rig (STI-203's
   carry-forward must still hold).
4. Seed something that reaches the model-correct shape, per `CLAUDE.md` rule 8 — today every
   seeded row satisfies both signals, which is exactly why this is invisible.
5. If any surface still reads vehicle locations for containment, list it. Do not fix
   surfaces this ticket did not name.

## Related

- **STI-202** — added the columns and the schema comment this contradicts.
- **STI-203** — made the assignment columns the product's source of truth, creating the gap.
- **STI-206** — the other read-side consequence of the same migration.

## Files

- `packages/api-contracts/src/routers/location.ts` — `applyContainerCustody` and its
  `contents` query
- `packages/db/src/schema/asset.ts` — STI-202's three-column comment
- `.claude/rules/custody-and-ledger.md` — where the decision belongs
