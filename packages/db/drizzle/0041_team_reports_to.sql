ALTER TABLE "tbl_ops_project_team_member" ADD COLUMN "reports_to_employee_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_team_member" ADD CONSTRAINT "tbl_ops_project_team_member_reports_to_employee_id_tbl_entity_employee_id_fk" FOREIGN KEY ("reports_to_employee_id") REFERENCES "public"."tbl_entity_employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ptm_reports_to_idx" ON "tbl_ops_project_team_member" USING btree ("reports_to_employee_id");