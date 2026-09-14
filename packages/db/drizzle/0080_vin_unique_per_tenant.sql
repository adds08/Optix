--
-- A VIN identifies exactly one vehicle, per tenant — where it is present.
--
-- The client's rule, 2026-09-14: "for VIN its missing data, they will fill it
-- as time goes by! just remember that! but VIN is always unique, but nullable!"
--
-- Both halves matter and they are not in tension:
--
--   NULLABLE  Urban's fleet data has no VINs yet. They arrive over time, a few
--             at a time, as somebody walks the yard with a clipboard. A NOT NULL
--             here would make the equipment import impossible today.
--   UNIQUE    A VIN is the manufacturer's permanent identity — the one thing
--             about a truck that never changes, unlike its code or its plate.
--             Two vehicles with one VIN means one of them is wrong, and finding
--             out later is worse than being told at the write.
--
-- Partial index, so the 88 rows with no VIN are all legal and only a REPEAT is
-- refused. `lower()` because a VIN's case is not its identity, matching how
-- `code` is indexed on both registers.
--
-- WHAT THIS DELIBERATELY DOES NOT ADD: any length or format check. The schema
-- comment on the column argues that case and is right — Urban's real data has a
-- sixteen-character VIN where seventeen is the standard, and five trucks share
-- an improbable hand-typed prefix. Refusing a row over a malformed VIN loses
-- the whole vehicle. Uniqueness is a different question from validity: a typo
-- that collides is caught, a typo that does not is allowed to land and be
-- corrected, which is what the client described.
--
-- Safe: zero duplicate VINs in either local database, checked before writing.

CREATE UNIQUE INDEX IF NOT EXISTS "equipment_vin_per_tenant_uq"
  ON "tbl_entity_equipment" ("tenant_id", lower("vin"))
  WHERE "vin" IS NOT NULL AND btrim("vin") <> '';
