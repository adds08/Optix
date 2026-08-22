ALTER TABLE "transaction" ADD COLUMN "ref_message_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_ref_message_idx" ON "transaction" USING btree ("ref_message_id","asset_id");