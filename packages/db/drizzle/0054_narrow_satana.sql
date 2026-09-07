CREATE TABLE IF NOT EXISTS "tbl_ops_sync_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"mode" text DEFAULT 'preview' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by_user_id" uuid,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"refused_count" integer DEFAULT 0 NOT NULL,
	"flagged_count" integer DEFAULT 0 NOT NULL,
	"detail" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_sync_run" ADD CONSTRAINT "tbl_ops_sync_run_tenant_id_tbl_entity_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tbl_entity_tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_sync_run" ADD CONSTRAINT "tbl_ops_sync_run_requested_by_user_id_tbl_entity_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."tbl_entity_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_run_tenant_idx" ON "tbl_ops_sync_run" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_run_status_idx" ON "tbl_ops_sync_run" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_run_one_open_uq" ON "tbl_ops_sync_run" USING btree ("tenant_id","source") WHERE status in ('queued', 'running');