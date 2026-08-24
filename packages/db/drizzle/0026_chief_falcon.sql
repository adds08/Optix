ALTER TABLE "notification" ADD COLUMN "delivery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "last_attempt_at" timestamp with time zone;