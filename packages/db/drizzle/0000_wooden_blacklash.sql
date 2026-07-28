CREATE TABLE IF NOT EXISTS "permission" (
	"name" text PRIMARY KEY NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permission" (
	"role_id" uuid NOT NULL,
	"permission_name" text NOT NULL,
	CONSTRAINT "role_permission_role_id_permission_name_pk" PRIMARY KEY("role_id","permission_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_role" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "user_role_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"manufacturer_id" uuid,
	"name" text NOT NULL,
	"category_id" uuid,
	"default_unit_cost" numeric(14, 2),
	"is_serialized" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"default_maintenance_interval_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manufacturer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"cost_center" text,
	"site_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_phase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"end_date" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"warehouse_id" uuid,
	"project_id" uuid,
	"parent_location_id" uuid,
	"custodian_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"vehicle_type" text NOT NULL,
	"unit" text NOT NULL,
	"plate" text,
	"make_model" text,
	"ownership_type" text DEFAULT 'company_owned' NOT NULL,
	"payee_employee_id" uuid,
	"allowance_rate" numeric(10, 2),
	"allowance_frequency" text,
	"gps_lat" numeric(10, 6),
	"gps_lng" numeric(11, 6),
	"gps_at" timestamp with time zone,
	"gps_source" text,
	"project_id" uuid,
	"foreman_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"region" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"role" text DEFAULT 'foreman' NOT NULL,
	"primary_project_id" uuid,
	"employment_status" text DEFAULT 'active' NOT NULL,
	"terminated_at" timestamp with time zone,
	"reports_to_employee_id" uuid,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_project_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"assigned_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"model_id" uuid,
	"model_name" text NOT NULL,
	"category_name" text,
	"serial_number" text,
	"is_serialized" boolean DEFAULT true NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"acquisition_cost" numeric(14, 2),
	"acquisition_date" date,
	"owning_project_id" uuid,
	"warranty_expires_on" date,
	"current_status" text DEFAULT 'available' NOT NULL,
	"current_custodian_id" uuid,
	"current_project_id" uuid,
	"current_location_id" uuid,
	"condition" text DEFAULT 'good',
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"custodian_id" uuid NOT NULL,
	"project_id" uuid,
	"location_id" uuid,
	"type" text DEFAULT 'permanent' NOT NULL,
	"start_date" date NOT NULL,
	"expected_end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"approved_by" uuid,
	"returned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"from_custodian_id" uuid,
	"to_custodian_id" uuid,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"from_project_id" uuid,
	"to_project_id" uuid,
	"reason" text DEFAULT 'reallocation' NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipient_employee_id" uuid,
	"recipient_user_id" uuid,
	"type" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"channel" text DEFAULT 'in_app',
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"high_value_threshold" jsonb,
	"custody_approver_role" text DEFAULT 'equipment_admin',
	"overdue_escalate_after_days" jsonb,
	"missing_review_sla_days" jsonb,
	"discrepancy_review_sla_days" jsonb,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transaction" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transaction_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" uuid,
	"from_state" jsonb,
	"to_state" jsonb,
	"ref_type" text,
	"ref_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid,
	"actor_user_id" uuid,
	"actor_role" text,
	"actor_label" text,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"entity_label" text,
	"result" text DEFAULT 'success' NOT NULL,
	"error_message" text,
	"source" text DEFAULT 'api',
	"http_method" text,
	"http_path" text,
	"ip" text,
	"user_agent" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'department' NOT NULL,
	"member_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_employee_id" uuid,
	"body" text NOT NULL,
	"mentions" jsonb,
	"processing_status" text DEFAULT 'queued' NOT NULL,
	"intent_type" text,
	"intent_payload" jsonb,
	"proposed_action" jsonb,
	"executed_transaction_ids" jsonb,
	"handled_by_user_id" uuid,
	"handled_at" timestamp with time zone,
	"error_note" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assigned_to_employee_id" uuid,
	"created_by_user_id" uuid,
	"related_asset_id" uuid,
	"related_project_id" uuid,
	"source" text DEFAULT 'chat' NOT NULL,
	"source_message_id" uuid,
	"action_type" text,
	"pending_action" jsonb,
	"requested_by_employee_id" uuid,
	"department" text,
	"decline_reason" text,
	"escalation_count" integer DEFAULT 0 NOT NULL,
	"last_escalated_at" timestamp with time zone,
	"due_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role" ADD CONSTRAINT "role_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_name_permission_name_fk" FOREIGN KEY ("permission_name") REFERENCES "public"."permission"("name") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user" ADD CONSTRAINT "user_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_model" ADD CONSTRAINT "asset_model_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_model" ADD CONSTRAINT "asset_model_manufacturer_id_manufacturer_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturer"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_model" ADD CONSTRAINT "asset_model_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "category" ADD CONSTRAINT "category_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "manufacturer" ADD CONSTRAINT "manufacturer_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_phase" ADD CONSTRAINT "project_phase_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_phase" ADD CONSTRAINT "project_phase_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location" ADD CONSTRAINT "location_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location" ADD CONSTRAINT "location_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location" ADD CONSTRAINT "location_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location" ADD CONSTRAINT "location_parent_location_id_location_id_fk" FOREIGN KEY ("parent_location_id") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location" ADD CONSTRAINT "location_custodian_employee_id_employee_id_fk" FOREIGN KEY ("custodian_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_payee_employee_id_employee_id_fk" FOREIGN KEY ("payee_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_foreman_employee_id_employee_id_fk" FOREIGN KEY ("foreman_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee" ADD CONSTRAINT "employee_primary_project_id_project_id_fk" FOREIGN KEY ("primary_project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee" ADD CONSTRAINT "employee_reports_to_employee_id_employee_id_fk" FOREIGN KEY ("reports_to_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_project_assignment" ADD CONSTRAINT "employee_project_assignment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_project_assignment" ADD CONSTRAINT "employee_project_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_project_assignment" ADD CONSTRAINT "employee_project_assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_project_assignment" ADD CONSTRAINT "employee_project_assignment_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset" ADD CONSTRAINT "asset_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset" ADD CONSTRAINT "asset_model_id_asset_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."asset_model"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset" ADD CONSTRAINT "asset_owning_project_id_project_id_fk" FOREIGN KEY ("owning_project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset" ADD CONSTRAINT "asset_current_custodian_id_employee_id_fk" FOREIGN KEY ("current_custodian_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset" ADD CONSTRAINT "asset_current_project_id_project_id_fk" FOREIGN KEY ("current_project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset" ADD CONSTRAINT "asset_current_location_id_location_id_fk" FOREIGN KEY ("current_location_id") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset" ADD CONSTRAINT "asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignment" ADD CONSTRAINT "assignment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignment" ADD CONSTRAINT "assignment_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignment" ADD CONSTRAINT "assignment_custodian_id_employee_id_fk" FOREIGN KEY ("custodian_id") REFERENCES "public"."employee"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignment" ADD CONSTRAINT "assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignment" ADD CONSTRAINT "assignment_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignment" ADD CONSTRAINT "assignment_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer" ADD CONSTRAINT "transfer_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer" ADD CONSTRAINT "transfer_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer" ADD CONSTRAINT "transfer_from_custodian_id_employee_id_fk" FOREIGN KEY ("from_custodian_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer" ADD CONSTRAINT "transfer_to_custodian_id_employee_id_fk" FOREIGN KEY ("to_custodian_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer" ADD CONSTRAINT "transfer_from_location_id_location_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer" ADD CONSTRAINT "transfer_to_location_id_location_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer" ADD CONSTRAINT "transfer_from_project_id_project_id_fk" FOREIGN KEY ("from_project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer" ADD CONSTRAINT "transfer_to_project_id_project_id_fk" FOREIGN KEY ("to_project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer" ADD CONSTRAINT "transfer_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfer" ADD CONSTRAINT "transfer_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification" ADD CONSTRAINT "notification_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_employee_id_employee_id_fk" FOREIGN KEY ("recipient_employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_log" ADD CONSTRAINT "event_log_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel" ADD CONSTRAINT "channel_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_author_employee_id_employee_id_fk" FOREIGN KEY ("author_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_handled_by_user_id_user_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_assigned_to_employee_id_employee_id_fk" FOREIGN KEY ("assigned_to_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_related_asset_id_asset_id_fk" FOREIGN KEY ("related_asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_related_project_id_project_id_fk" FOREIGN KEY ("related_project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_requested_by_employee_id_employee_id_fk" FOREIGN KEY ("requested_by_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_tenant_idx" ON "role" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "role_tenant_name_uq" ON "role" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_slug_uq" ON "tenant" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_tenant_idx" ON "user" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_email_idx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_model_tenant_idx" ON "asset_model" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "category_tenant_idx" ON "category" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manufacturer_tenant_idx" ON "manufacturer" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tenant_idx" ON "project" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_phase_tenant_idx" ON "project_phase" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_phase_project_idx" ON "project_phase" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_tenant_idx" ON "location" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_parent_idx" ON "location" USING btree ("parent_location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_custodian_idx" ON "location" USING btree ("custodian_employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_tenant_idx" ON "vehicle" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_location_idx" ON "vehicle" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_tenant_idx" ON "warehouse" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employee_tenant_idx" ON "employee" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "epa_tenant_idx" ON "employee_project_assignment" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "epa_employee_idx" ON "employee_project_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "epa_project_idx" ON "employee_project_assignment" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_tenant_idx" ON "asset" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_tag_idx" ON "asset" USING btree ("tag");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_custodian_idx" ON "asset" USING btree ("current_custodian_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_project_idx" ON "asset" USING btree ("current_project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_status_idx" ON "asset" USING btree ("current_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignment_tenant_idx" ON "assignment" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignment_asset_idx" ON "assignment" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignment_custodian_idx" ON "assignment" USING btree ("custodian_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignment_status_idx" ON "assignment" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfer_tenant_idx" ON "transfer" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfer_asset_idx" ON "transfer" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfer_status_idx" ON "transfer" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_tenant_idx" ON "notification" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_recipient_idx" ON "notification" USING btree ("recipient_employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_type_idx" ON "notification" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_tenant_idx" ON "transaction" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_asset_idx" ON "transaction" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_occurred_idx" ON "transaction" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_log_tenant_idx" ON "event_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_log_created_idx" ON "event_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_tenant_idx" ON "channel" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_slug_idx" ON "channel" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_tenant_idx" ON "message" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_channel_idx" ON "message" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_status_idx" ON "message" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_tenant_idx" ON "task" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_status_idx" ON "task" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_assignee_idx" ON "task" USING btree ("assigned_to_employee_id");