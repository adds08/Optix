ALTER TABLE "assignment" ADD COLUMN "truck_id" uuid;--> statement-breakpoint
ALTER TABLE "assignment" ADD COLUMN "trailer_id" uuid;--> statement-breakpoint
ALTER TABLE "assignment" ADD COLUMN "truck_kind" text GENERATED ALWAYS AS ('truck') STORED;--> statement-breakpoint
ALTER TABLE "assignment" ADD COLUMN "trailer_kind" text GENERATED ALWAYS AS ('trailer') STORED;--> statement-breakpoint
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_id_type_uq" UNIQUE("id","vehicle_type");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignment" ADD CONSTRAINT "assignment_truck_fk" FOREIGN KEY ("truck_id","truck_kind") REFERENCES "public"."vehicle"("id","vehicle_type") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignment" ADD CONSTRAINT "assignment_trailer_fk" FOREIGN KEY ("trailer_id","trailer_kind") REFERENCES "public"."vehicle"("id","vehicle_type") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignment_truck_idx" ON "assignment" USING btree ("truck_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignment_trailer_idx" ON "assignment" USING btree ("trailer_id");
