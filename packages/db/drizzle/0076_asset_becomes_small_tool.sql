--
-- `tbl_entity_asset` becomes `tbl_entity_small_tool`.
--
-- The client's words, 2026-09-14: "remove calling small tools asset at table
-- level." Right, and the file's own header already agreed with them — it opens
-- "the asset register — small tools are the first-class entity". "Asset" could
-- mean a truck, a building or a laptop; this table holds drills, saws,
-- grinders, generators, survey gear and compaction plant. Trucks and trailers
-- are `tbl_entity_equipment` (migration 0075).
--
-- A RENAME, so Postgres carries the dependents itself: four incoming foreign
-- keys (transaction, smalltools_custody, transfer, task), the primary key, the
-- CHECK, and every index. Proven on a throwaway database before 0075 and
-- confirmed again after it.
--
-- The index and constraint NAMES are renamed too. `asset_code_idx` on a table
-- called small_tool is a half-done rename, and half-done is how the next
-- reader ends up unsure which name is current.
--
-- `asset_number_idx` is renamed rather than dropped, even though the column it
-- covers is itself on the way out (the client: "no reference_no field on small
-- tools"). Dropping the column is a separate migration with a real dependency
-- — it cannot land until code generation guarantees every tool has a `code` —
-- and bundling an unrelated drop into a rename is how a rename becomes
-- unreviewable.
--
-- NOT renamed, deliberately: the permission strings (`asset.read`,
-- `asset.manage`, `assets.view.*`) and the tRPC route `asset.list`. Those six
-- permissions are ROWS in `tbl_entity_permission` granted to roles, so renaming
-- them needs a grants migration — and per this repo's own rules, permission
-- changes have already cost three tickets by reaching fresh databases and not
-- live ones. Nothing a user sees is affected either way.

ALTER TABLE "tbl_entity_asset" RENAME TO "tbl_entity_small_tool";

ALTER TABLE "tbl_entity_small_tool"
  RENAME CONSTRAINT "asset_current_status_check" TO "small_tool_current_status_check";

ALTER INDEX "asset_pkey"           RENAME TO "small_tool_pkey";
ALTER INDEX "asset_tenant_idx"     RENAME TO "small_tool_tenant_idx";
ALTER INDEX "asset_code_idx"       RENAME TO "small_tool_code_idx";
ALTER INDEX "asset_custodian_idx"  RENAME TO "small_tool_custodian_idx";
ALTER INDEX "asset_project_idx"    RENAME TO "small_tool_project_idx";
ALTER INDEX "asset_status_idx"     RENAME TO "small_tool_status_idx";
ALTER INDEX "asset_number_idx"     RENAME TO "small_tool_number_idx";
