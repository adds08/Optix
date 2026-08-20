ALTER TABLE "transfer" ADD COLUMN "to_truck_id" uuid;--> statement-breakpoint
ALTER TABLE "transfer" ADD COLUMN "to_trailer_id" uuid;--> statement-breakpoint
ALTER TABLE "transfer" ADD COLUMN "to_truck_kind" text GENERATED ALWAYS AS ('truck') STORED;--> statement-breakpoint
ALTER TABLE "transfer" ADD COLUMN "to_trailer_kind" text GENERATED ALWAYS AS ('trailer') STORED;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer" ADD CONSTRAINT "transfer_to_truck_fk" FOREIGN KEY ("to_truck_id","to_truck_kind") REFERENCES "public"."vehicle"("id","vehicle_type") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer" ADD CONSTRAINT "transfer_to_trailer_fk" FOREIGN KEY ("to_trailer_id","to_trailer_kind") REFERENCES "public"."vehicle"("id","vehicle_type") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfer_to_truck_idx" ON "transfer" USING btree ("to_truck_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfer_to_trailer_idx" ON "transfer" USING btree ("to_trailer_id");