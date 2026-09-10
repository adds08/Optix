CREATE TABLE IF NOT EXISTS "tbl_ops_user_onboarding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"current_step" text DEFAULT 'projects' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tbl_ops_project_role_deferral" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"team_role" text NOT NULL,
	"deferred_by_user_id" uuid,
	"deferred_to_employee_id" uuid,
	"note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tbl_ops_project_team_member" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tbl_ops_project_team_member" ADD COLUMN "confirmed_by_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_user_onboarding" ADD CONSTRAINT "tbl_ops_user_onboarding_tenant_id_tbl_entity_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tbl_entity_tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_user_onboarding" ADD CONSTRAINT "tbl_ops_user_onboarding_user_id_tbl_entity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."tbl_entity_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_role_deferral" ADD CONSTRAINT "tbl_ops_project_role_deferral_tenant_id_tbl_entity_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tbl_entity_tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_role_deferral" ADD CONSTRAINT "tbl_ops_project_role_deferral_project_id_tbl_entity_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."tbl_entity_project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_role_deferral" ADD CONSTRAINT "tbl_ops_project_role_deferral_deferred_by_user_id_tbl_entity_user_id_fk" FOREIGN KEY ("deferred_by_user_id") REFERENCES "public"."tbl_entity_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_role_deferral" ADD CONSTRAINT "tbl_ops_project_role_deferral_deferred_to_employee_id_tbl_entity_employee_id_fk" FOREIGN KEY ("deferred_to_employee_id") REFERENCES "public"."tbl_entity_employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_onboarding_tenant_idx" ON "tbl_ops_user_onboarding" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_onboarding_user_uq" ON "tbl_ops_user_onboarding" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prd_tenant_idx" ON "tbl_ops_project_role_deferral" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prd_project_idx" ON "tbl_ops_project_role_deferral" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prd_one_open_uq" ON "tbl_ops_project_role_deferral" USING btree ("tenant_id","project_id","team_role") WHERE "tbl_ops_project_role_deferral"."resolved_at" is null;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_team_member" ADD CONSTRAINT "tbl_ops_project_team_member_confirmed_by_user_id_tbl_entity_user_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."tbl_entity_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
