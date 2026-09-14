--
-- Drop `tbl_entity_equipment.unit`. It was `code` stored twice.
--
-- Verified against Urban's real fleet before writing this: all 88 vehicles in
-- the recovered dataset carry `unit` and `code` set to the IDENTICAL value
-- (`unit: "TRK-003", code: "TRK-003"`). Zero of 88 differ. Two columns, one
-- fact.
--
-- The client's rule, settled 2026-09-07 and restated 2026-09-14: one `code`
-- per entity, and anything else that identifies a row is only allowed if it is
-- a genuinely different fact. `plate` (the registration, reassigned) and `vin`
-- (the manufacturer's, permanent) pass that test. `unit` does not.
--
-- ORDER MATTERS HERE. `unit` is NOT NULL and `code` is nullable, so the
-- backfill has to run before the drop or the surviving column loses values:
--
--   1. copy unit -> code wherever code is null or blank
--   2. make code NOT NULL, now that every row has one
--   3. drop unit
--
-- Step 1 is a no-op on any row where they already agree, which per the above
-- is every row Urban has. It exists for the rows a human typed a code into
-- without a unit, and for the local databases where the two were edited
-- independently while this was being decided.
--
-- Step 2 is the part that would abort on bad data, deliberately: if any row
-- reaches it with no code, the migration fails loudly rather than leaving a
-- nullable identity column behind. The API migrates on boot and refuses to
-- serve if this fails, which is the correct outcome — an equipment register
-- where some rows have no identifier is not something to serve.

UPDATE "tbl_entity_equipment"
   SET "code" = "unit"
 WHERE "code" IS NULL OR btrim("code") = '';

ALTER TABLE "tbl_entity_equipment" ALTER COLUMN "code" SET NOT NULL;

ALTER TABLE "tbl_entity_equipment" DROP COLUMN "unit";
