ALTER TABLE "tenant_settings" ADD COLUMN "llm_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "llm_base_url" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "llm_model" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "llm_api_key_enc" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "llm_api_key_hint" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "llm_timeout_ms" integer DEFAULT 15000 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "llm_last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "llm_last_check_ok" boolean;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "llm_last_check_error" text;