-- ---------------------------------------------------------------------------
-- Catches the SNAPSHOT up to 0062. No new intent; this is a no-op in effect.
--
-- 0060-0063 were hand-written, so `meta/_snapshot.json` was never regenerated
-- and still described these three FKs as ON DELETE NO ACTION -- the state
-- before 0062 changed them to CASCADE. drizzle-kit diffs schema.ts against the
-- newest snapshot, not against the database, so every `generate` re-emitted
-- this same block forever, and CI's drift check ("schema has changed without a
-- generated migration") failed on it. Regenerating is the fix: the SQL below is
-- what 0062 already did, and committing the 0064 snapshot alongside it is the
-- part that actually stops the loop.
--
-- Safe to re-apply. Postgres truncates all four identifiers to 63 characters --
-- they are 68/70/72 as written -- so the DROPs match the rows 0062 created and
-- the ADDs restore the identical constraints. Verified by replaying onto both a
-- fresh database and one migrated to 0061 first.
-- ---------------------------------------------------------------------------
ALTER TABLE "tbl_ops_project_access_restriction" DROP CONSTRAINT "tbl_ops_project_access_restriction_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_project_access_restriction" DROP CONSTRAINT "tbl_ops_project_access_restriction_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_project_access_restriction" DROP CONSTRAINT "tbl_ops_project_access_restriction_employee_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_access_restriction" ADD CONSTRAINT "tbl_ops_project_access_restriction_tenant_id_tbl_entity_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tbl_entity_tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_access_restriction" ADD CONSTRAINT "tbl_ops_project_access_restriction_project_id_tbl_entity_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."tbl_entity_project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_access_restriction" ADD CONSTRAINT "tbl_ops_project_access_restriction_employee_id_tbl_entity_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."tbl_entity_employee"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
