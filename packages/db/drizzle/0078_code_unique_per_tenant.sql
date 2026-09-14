--
-- A code identifies exactly one thing, per tenant.
--
-- The client's rule, 2026-09-14: "code is always unique for entity, any entity!
-- If duplicate it should reject insert, and in frontend should warn the users."
--
-- Only `project` and `uom_category` enforced this before now. `small_tool.code`
-- and `equipment.code` accepted duplicates, so two drills could both be
-- `TOOL-00042` and every screen that showed one would be ambiguous about which.
--
-- The shape copies `project_code_per_tenant_uq` (migration 0065) rather than
-- inventing one, and three properties of it matter:
--
--   lower(code)         `trk-034` and `TRK-034` are the same code. Case is not
--                       an identity, and the router's pre-check uses lower()
--                       too so the two agree.
--   WHERE code NOT NULL Partial, so a row without a code is still legal.
--                       `small_tool.code` is nullable — the code generator
--                       fills it on create, but a row imported before that
--                       existed may have none.
--   per tenant          Two customers may both run a TRK-001.
--
-- THE READABLE ERROR IS NOT THIS INDEX. `asset.create`, `asset.update`,
-- `vehicle.create` and `vehicle.update` each pre-check and raise a CONFLICT
-- naming the row already holding the code — "TOOL-00042 is already in the
-- register." This index is the floor under writers that never pass a router:
-- an import, a worker, a fixture, a hand-run UPDATE. It raises a raw 23505,
-- which is why the pre-checks exist.
--
-- SAFE: checked for duplicates in both databases before writing this, and
-- found none. If a production row collides, this migration aborts — and the
-- API migrates on boot, so it would refuse to serve. That is the correct
-- outcome: two tools sharing a code is not a register worth serving, and the
-- fix is to rename one.

CREATE UNIQUE INDEX IF NOT EXISTS "small_tool_code_per_tenant_uq"
  ON "tbl_entity_small_tool" ("tenant_id", lower("code"))
  WHERE "code" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "equipment_code_per_tenant_uq"
  ON "tbl_entity_equipment" ("tenant_id", lower("code"));
