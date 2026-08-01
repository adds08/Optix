CREATE TABLE IF NOT EXISTS "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"theme_name" text DEFAULT 'drafting-ink' NOT NULL,
	"font_family" text DEFAULT 'system' NOT NULL,
	"font_scale" text DEFAULT '1.0' NOT NULL,
	"density" text DEFAULT 'comfortable' NOT NULL,
	"dashboard" jsonb DEFAULT '{"widgets":{}}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "classification" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "llm_summary" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_preferences_user_uq" ON "user_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_preferences_tenant_idx" ON "user_preferences" USING btree ("tenant_id");