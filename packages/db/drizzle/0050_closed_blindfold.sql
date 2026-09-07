CREATE TABLE IF NOT EXISTS "tbl_entity_division" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tbl_entity_employee_external_ref" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"system" text NOT NULL,
	"external_id" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"restricted_fields" jsonb,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tbl_entity_employee" RENAME COLUMN "external_id" TO "code";--> statement-breakpoint
ALTER TABLE "tbl_entity_employee" ADD COLUMN "division_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_entity_division" ADD CONSTRAINT "tbl_entity_division_tenant_id_tbl_entity_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tbl_entity_tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_entity_employee_external_ref" ADD CONSTRAINT "tbl_entity_employee_external_ref_tenant_id_tbl_entity_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tbl_entity_tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_entity_employee_external_ref" ADD CONSTRAINT "tbl_entity_employee_external_ref_employee_id_tbl_entity_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."tbl_entity_employee"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "division_tenant_idx" ON "tbl_entity_division" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "division_tenant_name_uq" ON "tbl_entity_division" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eer_tenant_idx" ON "tbl_entity_employee_external_ref" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eer_employee_idx" ON "tbl_entity_employee_external_ref" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eer_system_id_uq" ON "tbl_entity_employee_external_ref" USING btree ("tenant_id","system","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eer_employee_system_uq" ON "tbl_entity_employee_external_ref" USING btree ("tenant_id","employee_id","system");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_entity_employee" ADD CONSTRAINT "tbl_entity_employee_division_id_tbl_entity_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."tbl_entity_division"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
