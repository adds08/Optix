ALTER TABLE "tbl_entity_project" ALTER COLUMN "status" SET DEFAULT 'not_awarded';--> statement-breakpoint
ALTER TABLE "tbl_entity_project" ALTER COLUMN "start_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tbl_entity_project" ADD COLUMN "description" text;