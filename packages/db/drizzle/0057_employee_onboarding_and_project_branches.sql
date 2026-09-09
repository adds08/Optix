CREATE TABLE IF NOT EXISTS "tbl_config_employee_role_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_title" text NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"role_id" uuid,
	"disposition" text DEFAULT 'review' NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tbl_ops_project_access_restriction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tbl_entity_role" ADD COLUMN "claim_tier_names" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tbl_ops_user_onboarding" ADD COLUMN "claiming_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tbl_entity_project" ADD COLUMN "kind" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "tbl_entity_employee" ADD COLUMN "creation_source" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "tbl_entity_employee" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_config_employee_role_mapping" ADD CONSTRAINT "tbl_config_employee_role_mapping_tenant_id_tbl_entity_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tbl_entity_tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_config_employee_role_mapping" ADD CONSTRAINT "tbl_config_employee_role_mapping_role_id_tbl_entity_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."tbl_entity_role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_config_employee_role_mapping" ADD CONSTRAINT "tbl_config_employee_role_mapping_updated_by_user_id_tbl_entity_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."tbl_entity_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_access_restriction" ADD CONSTRAINT "tbl_ops_project_access_restriction_tenant_id_tbl_entity_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tbl_entity_tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_access_restriction" ADD CONSTRAINT "tbl_ops_project_access_restriction_project_id_tbl_entity_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."tbl_entity_project"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_access_restriction" ADD CONSTRAINT "tbl_ops_project_access_restriction_employee_id_tbl_entity_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."tbl_entity_employee"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_access_restriction" ADD CONSTRAINT "tbl_ops_project_access_restriction_created_by_user_id_tbl_entity_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."tbl_entity_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employee_role_mapping_uq" ON "tbl_config_employee_role_mapping" USING btree ("tenant_id","job_title","department");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_access_restriction_uq" ON "tbl_ops_project_access_restriction" USING btree ("tenant_id","project_id","employee_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_entity_employee" ADD CONSTRAINT "tbl_entity_employee_created_by_user_id_tbl_entity_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."tbl_entity_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
-- Existing completions must not become another chance to claim projects.
UPDATE "tbl_ops_user_onboarding" SET "claiming_closed_at" = "completed_at" WHERE "completed_at" IS NOT NULL;
--> statement-breakpoint
-- One-time conversion of legacy yard records; future classification is explicit.
UPDATE "tbl_entity_project" SET "kind" = 'yard' WHERE lower(trim("name")) = 'equipment yard';
--> statement-breakpoint
UPDATE "tbl_entity_employee" e SET "creation_source" = 'bamboohr'
WHERE EXISTS (SELECT 1 FROM "tbl_entity_employee_external_ref" r WHERE r.employee_id = e.id AND r.tenant_id = e.tenant_id AND r.system = 'bamboohr');
