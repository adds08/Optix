CREATE TABLE IF NOT EXISTS "company_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unit_of_measure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uom_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text DEFAULT 'mobile' NOT NULL,
	"value" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle" ADD COLUMN "equipment_class" text DEFAULT 'vehicle' NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicle" ADD COLUMN "can_attach" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicle" ADD COLUMN "is_attachable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employee" ADD COLUMN "company_role_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_role" ADD CONSTRAINT "company_role_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unit_of_measure" ADD CONSTRAINT "unit_of_measure_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unit_of_measure" ADD CONSTRAINT "unit_of_measure_category_id_uom_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."uom_category"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uom_category" ADD CONSTRAINT "uom_category_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_contact" ADD CONSTRAINT "employee_contact_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_contact" ADD CONSTRAINT "employee_contact_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_role_tenant_idx" ON "company_role" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_role_tenant_name_uq" ON "company_role" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uom_tenant_idx" ON "unit_of_measure" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uom_tenant_symbol_uq" ON "unit_of_measure" USING btree ("tenant_id","symbol");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uom_category_tenant_idx" ON "uom_category" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uom_category_tenant_code_uq" ON "uom_category" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employee_contact_tenant_idx" ON "employee_contact" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employee_contact_employee_idx" ON "employee_contact" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employee_contact_one_primary_uq" ON "employee_contact" USING btree ("tenant_id","employee_id") WHERE "employee_contact"."is_primary";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee" ADD CONSTRAINT "employee_company_role_id_company_role_id_fk" FOREIGN KEY ("company_role_id") REFERENCES "public"."company_role"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
