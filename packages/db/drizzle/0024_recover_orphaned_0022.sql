-- Recovers two migrations that were generated on separate branches, both
-- numbered 0022, and lost in the merge that resolved `meta/_journal.json` by
-- taking the side that had no idx-22 entry at all. Both `.sql` files sat in
-- this folder unreferenced by the journal, so `db:migrate` never applied
-- either one to a fresh database, while `drizzle-kit generate` kept re-emitting
-- the vehicle index forever because the surviving `0022_snapshot.json` was the
-- half that predated it. Both statements are idempotent: a database that
-- migrated before the merge already has them.

-- was 0022_strong_dust (STI-502)
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_one_truck_per_foreman_uq" ON "vehicle" USING btree ("tenant_id","foreman_employee_id") WHERE "vehicle"."vehicle_type" = 'truck' AND "vehicle"."foreman_employee_id" IS NOT NULL AND "vehicle"."ownership_type" = 'company_owned';
--> statement-breakpoint
-- was 0022_shocking_baron_strucker (ADR-7 blocky default)
ALTER TABLE "user_preferences" ALTER COLUMN "theme_name" SET DEFAULT 'blocky';
