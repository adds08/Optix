ALTER TABLE "tbl_entity_project" ADD COLUMN "latitude" numeric(10, 6);--> statement-breakpoint
ALTER TABLE "tbl_entity_project" ADD COLUMN "longitude" numeric(11, 6);--> statement-breakpoint
ALTER TABLE "tbl_entity_project" ADD COLUMN "geofence_radius_m" integer;