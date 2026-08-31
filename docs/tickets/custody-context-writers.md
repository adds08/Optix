# Carry truck and trailer through custody and `toState`

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
   **Do NOT assume `rig-picker.tsx` is reusable — an earlier version of this ticket said
   to reuse it, and that was wrong.** It does have `truckId`/`trailerId` locals, but it
   solves a different problem: which truck a *trailer is hitched to* and who *holds a
   vehicle*, via `location.setCustodian` and `vehicle.update { attachedToVehicleId }`.

   This ticket is about which truck and trailer **a tool rode in when its custody moved** —
   `assignment.truckId`/`trailerId`, a per-assignment historical fact. The two models share
   variable names and nothing else, and conflating them would put vehicle-hitching state
   into the custody ledger.

   Read `rig-picker.tsx`'s header comment before deciding. If a small piece is genuinely
   shareable (a vehicle search/select control), share that piece — but say what you decided
   and why. None of the four forms currently import it.
4. Tools-by-jobsite shows holder, truck and trailer against each tool
   (`SYSTEM_PLAN.md` §6.5). The screen is
   `apps/web/app/(app)/jobsites/page.tsx`.
5. The tool detail screen shows the current truck and trailer.
6. Selecting a trailer that is not a trailer, or a truck that is not a truck, is
   rejected with a typed error the UI can render.
7. Verified in a real browser, with the resulting `assignment` row **and** the
   `transaction.to_state` queried directly to confirm both were written.

## New in scope — three raw-FK error paths STI-202 created

STI-202's composite FKs use `ON DELETE NO ACTION` (`SET NULL` is illegal on a generated
column). Once `truck_id`/`trailer_id` carry values — which they do **from the next
reseed**, because the seed now attaches the synthetic truck to TOOL-0001 — three
existing routes raise a raw Postgres FK error and surface as a 500. Treat these as
live, not theoretical. All in `packages/api-contracts/src/routers/location.ts`:

1. **`vehicle.delete`** — procedure at `:641`, deletes at `:663-664`. Needs an
   "assignments reference this vehicle" pre-check returning a friendly `BAD_REQUEST`,
   alongside the existing tools-aboard guard at `:650-660`.
   **Closed and historical assignment rows count too** — the FK does not care about
   status — so the message must say the vehicle has assignment *history*, not just
   active custody. Getting this wrong produces a guard that passes and then still 500s.
2. **`vehicle.update`, the `vehicleType` flip** — input at `:534`, applied at `:569`.
   Flipping a referenced truck to trailer violates the composite FK. Reject the type
   change when any assignment references the vehicle.
3. ~~**`location.delete`**~~ — **this prediction was wrong; do not write a guard for it.**
   STI-202's QA drove it and found a *pre-existing* guard at `:327` already refuses
   first: `"This is ZZ-SEED-TRUCK (synthetic)'s location. Delete the vehicle instead."`
   (400). The cascade never runs and the FK is never reached. Verified by attempting it
   against the running API, not reasoned about.

   It is listed here because a guard written against the original prediction would have
   been dead code, and because the next person will make the same inference from the
   `ON DELETE CASCADE` on `vehicle.locationId`.

The other `update(schema.vehicle)` sites (`:65`, `:314`, `:435`) set GPS and custodian
fields only and never touch `vehicleType`. No guard needed there.

**So the guard work is two paths, not three.**

## The composite FK is tenant-blind — your writers must not be

Found by STI-202's QA. `vehicle_id_type_uq` is `(id, vehicle_type)` with **no tenant
component**, so at the database level an assignment in tenant A can reference tenant B's
truck. The FK guarantees the vehicle *type*; it guarantees nothing about the tenant.

Only one tenant is seeded, so this could not be demonstrated empirically — it is
structural, not observed. That makes it exactly the kind of thing that stays invisible
until a second tenant exists.

**Every truck/trailer lookup you add must carry `eq(vehicle.tenantId, tid)`** —
non-negotiable 3, and here the database will not catch you.

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
