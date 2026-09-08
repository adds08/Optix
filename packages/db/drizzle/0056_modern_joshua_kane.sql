CREATE TABLE IF NOT EXISTS "tbl_entity_team_role_assigner" (
	"team_role_id" uuid NOT NULL,
	"assigner_team_role_id" uuid NOT NULL,
	CONSTRAINT "tbl_entity_team_role_assigner_team_role_id_assigner_team_role_id_pk" PRIMARY KEY("team_role_id","assigner_team_role_id")
);
--> statement-breakpoint
ALTER TABLE "tbl_entity_team_role" ADD COLUMN "assignable_by_everyone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_entity_team_role_assigner" ADD CONSTRAINT "tbl_entity_team_role_assigner_team_role_id_tbl_entity_team_role_id_fk" FOREIGN KEY ("team_role_id") REFERENCES "public"."tbl_entity_team_role"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_entity_team_role_assigner" ADD CONSTRAINT "tbl_entity_team_role_assigner_assigner_team_role_id_tbl_entity_team_role_id_fk" FOREIGN KEY ("assigner_team_role_id") REFERENCES "public"."tbl_entity_team_role"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
