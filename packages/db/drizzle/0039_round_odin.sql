ALTER TABLE "tbl_ops_project_team_member" ADD COLUMN "source" text DEFAULT 'equipment_department' NOT NULL;--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Superintendents may hold custody.
-- ---------------------------------------------------------------------------
-- The column above is the schema half of this change; this is the data half,
-- and it is required for the same reason 0020, 0025 and 0038 were: `role` is
-- written by the SEED, the seed only runs against a fresh database, and
-- Urban's was seeded on 2026-07-28. Flipping `canHoldCustody` in seed-data.ts
-- reaches every dev machine and no live one, which would leave the live
-- database with `superintendent` still unable to hold a tool while
-- `CUSTODIAN_ROLES` in the code says otherwise — the two disagreeing is
-- exactly what `rbac-matrix.test.ts` exists to prevent, and it only checks a
-- freshly seeded tenant. See the rule in `.claude/rules/database.md`.
--
-- Why the capability is being granted at all: a job is routinely awarded and
-- rigged before its foreman is hired, and the superintendent running the crews
-- is the person physically holding the small tools, the truck and the trailer
-- until then. Excluding them never stopped that happening — it stopped it
-- being recorded, so the register showed a rigged job with nobody holding
-- anything.
--
-- Guarded on the current value rather than set unconditionally. The Roles
-- screen can edit these flags, so the predicate says "raise the ones still on
-- the old default" instead of "overwrite whatever is there".
UPDATE "tbl_entity_role"
   SET "can_hold_custody" = true
 WHERE "name" = 'superintendent'
   AND "can_hold_custody" = false;
