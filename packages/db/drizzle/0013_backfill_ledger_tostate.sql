-- STI-101: backfill `to_state` on the existing ledger with one baseline event per asset.
--
-- Every pre-existing `transaction` row carries a null `to_state` (the seed's known
-- defect — see .claude/rules/database.md), so `foldAssetState` has nothing to fold
-- and `asset.rebuild` is a no-op on all existing data. The ledger is append-only:
-- this INSERTs a compensating baseline row per asset and never touches history.
--
-- The snapshot carries ALL FOUR keys with explicit JSON nulls. The fold REPLACES
-- rather than merges (packages/domain/src/fold.ts), so a missing key does not mean
-- "unchanged" — it means undefined after the next rebuild. That partial-snapshot
-- bug has shipped twice; fold.test.ts pins it. jsonb_build_object emits an explicit
-- null for a null column, which is exactly what the fold contract requires.
--
-- `occurred_at` is the asset's earliest event minus one second — NOT `created_at`,
-- which the ticket sketched: on this data every asset's `created_at` is >= its
-- earliest event, and ties break on row `id` ascending, where this new row always
-- loses (its identity id is higher than every historical row's). Sorting the
-- baseline anything but strictly first would let it win the fold over genuine
-- history. Assets with no events yet fall back to `created_at`.
--
-- Idempotent: the NOT EXISTS guard skips any asset that already has a complete
-- snapshot in its ledger, whether from a prior run of this backfill or from a
-- runtime writer. Re-running inserts zero rows.
INSERT INTO "transaction"
  ("tenant_id", "asset_id", "event_type", "actor_id", "to_state", "note", "occurred_at")
SELECT
  a."tenant_id",
  a."id",
  'projection_baseline',
  NULL,
  jsonb_build_object(
    'status',      a."current_status",
    'custodianId', a."current_custodian_id",
    'projectId',   a."current_project_id",
    'locationId',  a."current_location_id"
  ),
  'STI-101 baseline: ledger predates complete snapshots',
  coalesce(t."min_occurred" - interval '1 second', a."created_at", now())
FROM "asset" a
LEFT JOIN (
  SELECT "asset_id", min("occurred_at") AS "min_occurred"
  FROM "transaction"
  GROUP BY "asset_id"
) t ON t."asset_id" = a."id"
WHERE NOT EXISTS (
  SELECT 1 FROM "transaction" tx
  WHERE tx."asset_id" = a."id"
    AND tx."to_state" IS NOT NULL
);
