/*
  The tail of the table rename (0029), and why it is a second file.

  Two kinds of object embed the table name in their DEFINITION rather than just
  in their own name, so renaming the table is not enough and Drizzle regenerates
  them:

    - the four PARTIAL unique indexes, whose `WHERE` predicate is qualified
      ("tbl_entity_vehicle"."vehicle_type" = 'truck')
    - `tenant_slug_unique`, a constraint name derived from a column `.unique()`

  Drizzle emits these as drop-and-recreate because an index predicate cannot be
  altered in place. That briefly drops `assignment_one_active_uq` — the backstop
  that stops one tool having two active custodians — and recreates it a
  statement later. Both run inside the same migration, so there is no window in
  which the database is open to a second custodian.
*/
ALTER TABLE "tbl_entity_tenant" DROP CONSTRAINT "tenant_slug_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "vehicle_one_truck_per_foreman_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "employee_contact_one_primary_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "ptm_one_active_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "assignment_one_active_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_one_truck_per_foreman_uq" ON "tbl_entity_vehicle" USING btree ("tenant_id","foreman_employee_id") WHERE "tbl_entity_vehicle"."vehicle_type" = 'truck' AND "tbl_entity_vehicle"."foreman_employee_id" IS NOT NULL AND "tbl_entity_vehicle"."ownership_type" = 'company_owned';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employee_contact_one_primary_uq" ON "tbl_entity_employee_contact" USING btree ("tenant_id","employee_id") WHERE "tbl_entity_employee_contact"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ptm_one_active_uq" ON "tbl_ops_project_team_member" USING btree ("tenant_id","project_id","employee_id","role") WHERE "tbl_ops_project_team_member"."ended_on" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assignment_one_active_uq" ON "tbl_ops_smalltools_custody" USING btree ("asset_id") WHERE "tbl_ops_smalltools_custody"."status" = 'active';--> statement-breakpoint
ALTER TABLE "tbl_entity_tenant" ADD CONSTRAINT "tbl_entity_tenant_slug_unique" UNIQUE("slug");