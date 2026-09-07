ALTER TABLE "tbl_entity_employee" ADD COLUMN "department_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tbl_entity_employee" ADD CONSTRAINT "tbl_entity_employee_department_id_tbl_entity_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."tbl_entity_department"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
