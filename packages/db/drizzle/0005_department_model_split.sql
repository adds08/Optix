CREATE TABLE IF NOT EXISTS "department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ALTER COLUMN "tag" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "make" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "model_number" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "other_ref" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "cost_target" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "owning_department_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "department" ADD CONSTRAINT "department_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "department_tenant_idx" ON "department" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "department_tenant_name_uq" ON "department" USING btree ("tenant_id","name");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset" ADD CONSTRAINT "asset_owning_department_id_department_id_fk" FOREIGN KEY ("owning_department_id") REFERENCES "public"."department"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- One department every tenant needs on day one: shop tools are not on any job,
-- and they still have to be charged to something. See docs/11-department-cost-targets.md.
insert into department (tenant_id, name, code, is_active)
select id, 'Repair & Maintenance', 'RM', true from tenant
on conflict do nothing;
--> statement-breakpoint
-- Explicit rather than relying on the column default, so the intent is in the
-- migration history and not only in the schema file.
update asset set cost_target = 'project' where cost_target is null;
--> statement-breakpoint
-- The split backfill, deliberately crude: everything lands in description and
-- make/modelNumber stay null. No parsing heuristic — "DeWalt DCH273 Rotary
-- Hammer" has no reliable split point, and a heuristic would be wrong on many
-- rows and, worse, wrong invisibly. See docs/12-model-field-split.md.
update asset set description = model_name where model_name is not null;
--> statement-breakpoint
ALTER TABLE "asset" DROP COLUMN IF EXISTS "model_name";