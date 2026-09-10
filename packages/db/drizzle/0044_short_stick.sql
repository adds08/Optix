ALTER TABLE "tbl_entity_team_role" ADD COLUMN "reports_to_team_role_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_entity_team_role" ADD CONSTRAINT "tbl_entity_team_role_reports_to_team_role_id_tbl_entity_team_role_id_fk" FOREIGN KEY ("reports_to_team_role_id") REFERENCES "public"."tbl_entity_team_role"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
