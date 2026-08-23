-- UI-66: close out `transfer` rows stranded in `pending_verification`.
--
-- The reported symptom was a duplicate: UIC-1003 showed twice in Custody → Moving,
-- both rows identical — Handoff, Pending Verification, Aug 4 2026. The duplicate
-- half of that has a writer-side guard now (apply-action.ts refuses to queue a
-- second open hand-off for a tool). This is the other half, which the guard cannot
-- reach: the rows that already exist.
--
-- `pending_verification` belonged to the borrow model, removed on 2026-08-09 with
-- the whole verify step (see the header of routers/transfer.ts and the changelog).
-- Nothing writes the value any more. The problem is that nothing can *read* it out
-- of that state either: transfer.approve, transfer.decline and transfer.cancel all
-- guard on `status = 'pending_approval'` and raise CONFLICT otherwise, so there is
-- no button anywhere in the product that moves one of these rows. They are not
-- merely stale — they are permanently stuck, rendering in the Moving tab forever
-- with no action that can clear them. The schema comment on transfer.status has
-- already listed only pending_approval|approved|completed|cancelled since the
-- removal, so these rows hold a value the schema itself no longer describes.
--
-- `cancelled`, not `completed`: these transfers never took effect. The branch that
-- created them wrote NO ledger row at all — it queued a desk entry and nothing
-- moved — so no asset's custody, project or location depends on them, and marking
-- them completed would claim a hand-off that never happened. Cancelled says what
-- is true: it was queued, and it was never applied.
--
-- No compensating ledger event is written, deliberately. `transfer.decline` does
-- write one (STI-112 — "considered, and refused" belongs in a tool's history), but
-- that records a decision a person actually made. Nobody decided these; they are
-- orphans of a deleted feature, and inventing a status_change event would put a
-- judgement in the audit trail that no human ever exercised. Custody is untouched
-- either way, so the fold and the register cannot disagree because of this.
--
-- Idempotent: re-running matches zero rows. Deliberately not tenant-scoped — this
-- is a schema-wide repair of a value no tenant should hold, the same shape as the
-- 0013 ledger backfill.
UPDATE "transfer"
SET "status" = 'cancelled',
    "updated_at" = now()
WHERE "status" = 'pending_verification';
