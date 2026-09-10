CREATE TABLE IF NOT EXISTS "tbl_ops_project_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_claim" ADD CONSTRAINT "tbl_ops_project_claim_tenant_id_tbl_entity_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tbl_entity_tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_claim" ADD CONSTRAINT "tbl_ops_project_claim_project_id_tbl_entity_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."tbl_entity_project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_ops_project_claim" ADD CONSTRAINT "tbl_ops_project_claim_user_id_tbl_entity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."tbl_entity_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_claim_tenant_idx" ON "tbl_ops_project_claim" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_claim_project_idx" ON "tbl_ops_project_claim" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_claim_one_uq" ON "tbl_ops_project_claim" USING btree ("tenant_id","user_id","project_id");