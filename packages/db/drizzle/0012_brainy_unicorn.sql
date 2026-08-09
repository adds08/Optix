DROP TABLE "rental_line" CASCADE;--> statement-breakpoint
DROP TABLE "rental_order" CASCADE;--> statement-breakpoint
DROP TABLE "vendor" CASCADE;--> statement-breakpoint
ALTER TABLE "assignment" DROP COLUMN IF EXISTS "type";--> statement-breakpoint
ALTER TABLE "assignment" DROP COLUMN IF EXISTS "expected_end_date";