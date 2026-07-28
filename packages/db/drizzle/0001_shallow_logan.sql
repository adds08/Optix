CREATE TABLE IF NOT EXISTS "rental_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"cat_class" text,
	"item_name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" text DEFAULT 'quoted' NOT NULL,
	"returned_on" date,
	"unit_rate" numeric(12, 2),
	"rate_unit" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rental_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"external_number" text NOT NULL,
	"order_type" text DEFAULT 'quote' NOT NULL,
	"status" text DEFAULT 'quoted' NOT NULL,
	"jobsite_label" text,
	"project_id" uuid,
	"ordered_by_label" text,
	"ordered_by_employee_id" uuid,
	"start_date" date,
	"end_date" date,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"account_number" text,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"external_id" text,
	"is_active" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_line" ADD CONSTRAINT "rental_line_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_line" ADD CONSTRAINT "rental_line_order_id_rental_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."rental_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_order" ADD CONSTRAINT "rental_order_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_order" ADD CONSTRAINT "rental_order_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_order" ADD CONSTRAINT "rental_order_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_order" ADD CONSTRAINT "rental_order_ordered_by_employee_id_employee_id_fk" FOREIGN KEY ("ordered_by_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_order" ADD CONSTRAINT "rental_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor" ADD CONSTRAINT "vendor_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_line_tenant_idx" ON "rental_line" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_line_order_idx" ON "rental_line" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_line_status_idx" ON "rental_line" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_line_cat_class_idx" ON "rental_line" USING btree ("cat_class");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_order_tenant_idx" ON "rental_order" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_order_vendor_idx" ON "rental_order" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_order_number_idx" ON "rental_order" USING btree ("external_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_order_status_idx" ON "rental_order" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_order_project_idx" ON "rental_order" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_tenant_idx" ON "vendor" USING btree ("tenant_id");