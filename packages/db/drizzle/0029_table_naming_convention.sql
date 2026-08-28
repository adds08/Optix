/*
  Table naming convention (2026-08-28): tbl_<domain>_<name>.

  `entity` is a register — a thing the business keeps a record of.
  `ops` is something that happens to one: custody, transfers, the ledger,
  postings, messages, tasks.

  RENAME, never drop-and-create. Every one of these tables holds live rows,
  and `drizzle-kit generate` cannot be used for a rename — it prompts
  interactively and, given no answer, would emit DROP + CREATE. This file
  and its snapshot are written by hand for exactly that reason.
*/
--> statement-breakpoint
ALTER TABLE "asset" RENAME TO "tbl_entity_asset";
--> statement-breakpoint
ALTER TABLE "asset_model" RENAME TO "tbl_entity_asset_model";
--> statement-breakpoint
ALTER TABLE "assignment" RENAME TO "tbl_ops_smalltools_custody";
--> statement-breakpoint
ALTER TABLE "auth_token" RENAME TO "tbl_entity_auth_token";
--> statement-breakpoint
ALTER TABLE "category" RENAME TO "tbl_entity_category";
--> statement-breakpoint
ALTER TABLE "channel" RENAME TO "tbl_ops_channel";
--> statement-breakpoint
ALTER TABLE "company_role" RENAME TO "tbl_entity_company_role";
--> statement-breakpoint
ALTER TABLE "department" RENAME TO "tbl_entity_department";
--> statement-breakpoint
ALTER TABLE "employee" RENAME TO "tbl_entity_employee";
--> statement-breakpoint
ALTER TABLE "employee_contact" RENAME TO "tbl_entity_employee_contact";
--> statement-breakpoint
ALTER TABLE "employee_project_assignment" RENAME TO "tbl_ops_employee_project_assignment";
--> statement-breakpoint
ALTER TABLE "event_log" RENAME TO "tbl_ops_event_log";
--> statement-breakpoint
ALTER TABLE "location" RENAME TO "tbl_entity_location";
--> statement-breakpoint
ALTER TABLE "manufacturer" RENAME TO "tbl_entity_manufacturer";
--> statement-breakpoint
ALTER TABLE "message" RENAME TO "tbl_ops_message";
--> statement-breakpoint
ALTER TABLE "notification" RENAME TO "tbl_ops_notification";
--> statement-breakpoint
ALTER TABLE "permission" RENAME TO "tbl_entity_permission";
--> statement-breakpoint
ALTER TABLE "project" RENAME TO "tbl_entity_project";
--> statement-breakpoint
ALTER TABLE "project_group" RENAME TO "tbl_entity_project_group";
--> statement-breakpoint
ALTER TABLE "project_group_project" RENAME TO "tbl_entity_project_group_project";
--> statement-breakpoint
ALTER TABLE "project_group_user" RENAME TO "tbl_entity_project_group_user";
--> statement-breakpoint
ALTER TABLE "project_team_member" RENAME TO "tbl_ops_project_team_member";
--> statement-breakpoint
ALTER TABLE "role" RENAME TO "tbl_entity_role";
--> statement-breakpoint
ALTER TABLE "role_permission" RENAME TO "tbl_entity_role_permission";
--> statement-breakpoint
ALTER TABLE "session" RENAME TO "tbl_entity_session";
--> statement-breakpoint
ALTER TABLE "task" RENAME TO "tbl_ops_task";
--> statement-breakpoint
ALTER TABLE "tenant" RENAME TO "tbl_entity_tenant";
--> statement-breakpoint
ALTER TABLE "tenant_settings" RENAME TO "tbl_entity_tenant_settings";
--> statement-breakpoint
ALTER TABLE "transaction" RENAME TO "tbl_ops_transaction";
--> statement-breakpoint
ALTER TABLE "transfer" RENAME TO "tbl_ops_transfer";
--> statement-breakpoint
ALTER TABLE "unit_of_measure" RENAME TO "tbl_entity_unit_of_measure";
--> statement-breakpoint
ALTER TABLE "uom_category" RENAME TO "tbl_entity_uom_category";
--> statement-breakpoint
ALTER TABLE "user" RENAME TO "tbl_entity_user";
--> statement-breakpoint
ALTER TABLE "user_preferences" RENAME TO "tbl_entity_user_preferences";
--> statement-breakpoint
ALTER TABLE "user_role" RENAME TO "tbl_entity_user_role";
--> statement-breakpoint
ALTER TABLE "vehicle" RENAME TO "tbl_entity_vehicle";
--> statement-breakpoint
ALTER TABLE "warehouse" RENAME TO "tbl_entity_warehouse";
--> statement-breakpoint

/*
  Constraint names are DERIVED by Drizzle from the table names, so they have to
  move too — `generate` diffs on the name and would otherwise re-emit a
  drop/add for every one of them on the next run. Verified: it does.

  22 of these exceed Postgres's 63-byte identifier limit and are truncated
  with a NOTICE. That was checked rather than assumed: truncation is
  consistent, later DDL naming the long form resolves to the same
  identifier, and no two of them truncate to the same 63 bytes.
*/
--> statement-breakpoint
ALTER TABLE "tbl_entity_auth_token" RENAME CONSTRAINT "auth_token_tenant_id_tenant_id_fk" TO "tbl_entity_auth_token_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_auth_token" RENAME CONSTRAINT "auth_token_user_id_user_id_fk" TO "tbl_entity_auth_token_user_id_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_role" RENAME CONSTRAINT "role_tenant_id_tenant_id_fk" TO "tbl_entity_role_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_role_permission" RENAME CONSTRAINT "role_permission_role_id_role_id_fk" TO "tbl_entity_role_permission_role_id_tbl_entity_role_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_role_permission" RENAME CONSTRAINT "role_permission_permission_name_permission_name_fk" TO "tbl_entity_role_permission_permission_name_tbl_entity_permission_name_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_role_permission" RENAME CONSTRAINT "role_permission_role_id_permission_name_pk" TO "tbl_entity_role_permission_role_id_permission_name_pk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_session" RENAME CONSTRAINT "session_user_id_user_id_fk" TO "tbl_entity_session_user_id_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_session" RENAME CONSTRAINT "session_tenant_id_tenant_id_fk" TO "tbl_entity_session_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_user" RENAME CONSTRAINT "user_tenant_id_tenant_id_fk" TO "tbl_entity_user_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_user_preferences" RENAME CONSTRAINT "user_preferences_tenant_id_tenant_id_fk" TO "tbl_entity_user_preferences_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_user_preferences" RENAME CONSTRAINT "user_preferences_user_id_user_id_fk" TO "tbl_entity_user_preferences_user_id_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_user_role" RENAME CONSTRAINT "user_role_user_id_user_id_fk" TO "tbl_entity_user_role_user_id_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_user_role" RENAME CONSTRAINT "user_role_role_id_role_id_fk" TO "tbl_entity_user_role_role_id_tbl_entity_role_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_user_role" RENAME CONSTRAINT "user_role_user_id_role_id_pk" TO "tbl_entity_user_role_user_id_role_id_pk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_asset_model" RENAME CONSTRAINT "asset_model_tenant_id_tenant_id_fk" TO "tbl_entity_asset_model_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_asset_model" RENAME CONSTRAINT "asset_model_manufacturer_id_manufacturer_id_fk" TO "tbl_entity_asset_model_manufacturer_id_tbl_entity_manufacturer_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_asset_model" RENAME CONSTRAINT "asset_model_category_id_category_id_fk" TO "tbl_entity_asset_model_category_id_tbl_entity_category_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_category" RENAME CONSTRAINT "category_tenant_id_tenant_id_fk" TO "tbl_entity_category_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_category" RENAME CONSTRAINT "category_parent_id_category_id_fk" TO "tbl_entity_category_parent_id_tbl_entity_category_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_manufacturer" RENAME CONSTRAINT "manufacturer_tenant_id_tenant_id_fk" TO "tbl_entity_manufacturer_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_project" RENAME CONSTRAINT "project_tenant_id_tenant_id_fk" TO "tbl_entity_project_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_department" RENAME CONSTRAINT "department_tenant_id_tenant_id_fk" TO "tbl_entity_department_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_company_role" RENAME CONSTRAINT "company_role_tenant_id_tenant_id_fk" TO "tbl_entity_company_role_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_unit_of_measure" RENAME CONSTRAINT "unit_of_measure_tenant_id_tenant_id_fk" TO "tbl_entity_unit_of_measure_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_unit_of_measure" RENAME CONSTRAINT "unit_of_measure_category_id_uom_category_id_fk" TO "tbl_entity_unit_of_measure_category_id_tbl_entity_uom_category_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_uom_category" RENAME CONSTRAINT "uom_category_tenant_id_tenant_id_fk" TO "tbl_entity_uom_category_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_location" RENAME CONSTRAINT "location_tenant_id_tenant_id_fk" TO "tbl_entity_location_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_location" RENAME CONSTRAINT "location_warehouse_id_warehouse_id_fk" TO "tbl_entity_location_warehouse_id_tbl_entity_warehouse_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_location" RENAME CONSTRAINT "location_project_id_project_id_fk" TO "tbl_entity_location_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_location" RENAME CONSTRAINT "location_parent_location_id_location_id_fk" TO "tbl_entity_location_parent_location_id_tbl_entity_location_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_location" RENAME CONSTRAINT "location_custodian_employee_id_employee_id_fk" TO "tbl_entity_location_custodian_employee_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_vehicle" RENAME CONSTRAINT "vehicle_tenant_id_tenant_id_fk" TO "tbl_entity_vehicle_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_vehicle" RENAME CONSTRAINT "vehicle_location_id_location_id_fk" TO "tbl_entity_vehicle_location_id_tbl_entity_location_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_vehicle" RENAME CONSTRAINT "vehicle_payee_employee_id_employee_id_fk" TO "tbl_entity_vehicle_payee_employee_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_vehicle" RENAME CONSTRAINT "vehicle_project_id_project_id_fk" TO "tbl_entity_vehicle_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_vehicle" RENAME CONSTRAINT "vehicle_foreman_employee_id_employee_id_fk" TO "tbl_entity_vehicle_foreman_employee_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_warehouse" RENAME CONSTRAINT "warehouse_tenant_id_tenant_id_fk" TO "tbl_entity_warehouse_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_employee" RENAME CONSTRAINT "employee_tenant_id_tenant_id_fk" TO "tbl_entity_employee_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_employee" RENAME CONSTRAINT "employee_role_id_role_id_fk" TO "tbl_entity_employee_role_id_tbl_entity_role_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_employee" RENAME CONSTRAINT "employee_company_role_id_company_role_id_fk" TO "tbl_entity_employee_company_role_id_tbl_entity_company_role_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_employee" RENAME CONSTRAINT "employee_primary_project_id_project_id_fk" TO "tbl_entity_employee_primary_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_employee" RENAME CONSTRAINT "employee_reports_to_employee_id_employee_id_fk" TO "tbl_entity_employee_reports_to_employee_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_employee_contact" RENAME CONSTRAINT "employee_contact_tenant_id_tenant_id_fk" TO "tbl_entity_employee_contact_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_employee_contact" RENAME CONSTRAINT "employee_contact_employee_id_employee_id_fk" TO "tbl_entity_employee_contact_employee_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_employee_project_assignment" RENAME CONSTRAINT "employee_project_assignment_tenant_id_tenant_id_fk" TO "tbl_ops_employee_project_assignment_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_employee_project_assignment" RENAME CONSTRAINT "employee_project_assignment_employee_id_employee_id_fk" TO "tbl_ops_employee_project_assignment_employee_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_employee_project_assignment" RENAME CONSTRAINT "employee_project_assignment_project_id_project_id_fk" TO "tbl_ops_employee_project_assignment_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_employee_project_assignment" RENAME CONSTRAINT "employee_project_assignment_assigned_by_user_id_user_id_fk" TO "tbl_ops_employee_project_assignment_assigned_by_user_id_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_project_team_member" RENAME CONSTRAINT "project_team_member_tenant_id_tenant_id_fk" TO "tbl_ops_project_team_member_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_project_team_member" RENAME CONSTRAINT "project_team_member_project_id_project_id_fk" TO "tbl_ops_project_team_member_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_project_team_member" RENAME CONSTRAINT "project_team_member_employee_id_employee_id_fk" TO "tbl_ops_project_team_member_employee_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_project_team_member" RENAME CONSTRAINT "project_team_member_assigned_by_user_id_user_id_fk" TO "tbl_ops_project_team_member_assigned_by_user_id_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_asset" RENAME CONSTRAINT "asset_tenant_id_tenant_id_fk" TO "tbl_entity_asset_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_asset" RENAME CONSTRAINT "asset_model_id_asset_model_id_fk" TO "tbl_entity_asset_model_id_tbl_entity_asset_model_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_asset" RENAME CONSTRAINT "asset_owning_project_id_project_id_fk" TO "tbl_entity_asset_owning_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_asset" RENAME CONSTRAINT "asset_owning_department_id_department_id_fk" TO "tbl_entity_asset_owning_department_id_tbl_entity_department_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_asset" RENAME CONSTRAINT "asset_current_custodian_id_employee_id_fk" TO "tbl_entity_asset_current_custodian_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_asset" RENAME CONSTRAINT "asset_current_project_id_project_id_fk" TO "tbl_entity_asset_current_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_asset" RENAME CONSTRAINT "asset_current_location_id_location_id_fk" TO "tbl_entity_asset_current_location_id_tbl_entity_location_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_asset" RENAME CONSTRAINT "asset_created_by_user_id_fk" TO "tbl_entity_asset_created_by_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_smalltools_custody" RENAME CONSTRAINT "assignment_tenant_id_tenant_id_fk" TO "tbl_ops_smalltools_custody_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_smalltools_custody" RENAME CONSTRAINT "assignment_asset_id_asset_id_fk" TO "tbl_ops_smalltools_custody_asset_id_tbl_entity_asset_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_smalltools_custody" RENAME CONSTRAINT "assignment_custodian_id_employee_id_fk" TO "tbl_ops_smalltools_custody_custodian_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_smalltools_custody" RENAME CONSTRAINT "assignment_project_id_project_id_fk" TO "tbl_ops_smalltools_custody_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_smalltools_custody" RENAME CONSTRAINT "assignment_location_id_location_id_fk" TO "tbl_ops_smalltools_custody_location_id_tbl_entity_location_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_smalltools_custody" RENAME CONSTRAINT "assignment_approved_by_user_id_fk" TO "tbl_ops_smalltools_custody_approved_by_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transfer" RENAME CONSTRAINT "transfer_tenant_id_tenant_id_fk" TO "tbl_ops_transfer_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transfer" RENAME CONSTRAINT "transfer_asset_id_asset_id_fk" TO "tbl_ops_transfer_asset_id_tbl_entity_asset_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transfer" RENAME CONSTRAINT "transfer_from_custodian_id_employee_id_fk" TO "tbl_ops_transfer_from_custodian_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transfer" RENAME CONSTRAINT "transfer_to_custodian_id_employee_id_fk" TO "tbl_ops_transfer_to_custodian_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transfer" RENAME CONSTRAINT "transfer_from_location_id_location_id_fk" TO "tbl_ops_transfer_from_location_id_tbl_entity_location_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transfer" RENAME CONSTRAINT "transfer_to_location_id_location_id_fk" TO "tbl_ops_transfer_to_location_id_tbl_entity_location_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transfer" RENAME CONSTRAINT "transfer_from_project_id_project_id_fk" TO "tbl_ops_transfer_from_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transfer" RENAME CONSTRAINT "transfer_to_project_id_project_id_fk" TO "tbl_ops_transfer_to_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transfer" RENAME CONSTRAINT "transfer_requested_by_user_id_fk" TO "tbl_ops_transfer_requested_by_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transfer" RENAME CONSTRAINT "transfer_approved_by_user_id_fk" TO "tbl_ops_transfer_approved_by_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_notification" RENAME CONSTRAINT "notification_tenant_id_tenant_id_fk" TO "tbl_ops_notification_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_notification" RENAME CONSTRAINT "notification_recipient_employee_id_employee_id_fk" TO "tbl_ops_notification_recipient_employee_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_notification" RENAME CONSTRAINT "notification_recipient_user_id_user_id_fk" TO "tbl_ops_notification_recipient_user_id_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_tenant_settings" RENAME CONSTRAINT "tenant_settings_tenant_id_tenant_id_fk" TO "tbl_entity_tenant_settings_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transaction" RENAME CONSTRAINT "transaction_tenant_id_tenant_id_fk" TO "tbl_ops_transaction_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transaction" RENAME CONSTRAINT "transaction_asset_id_asset_id_fk" TO "tbl_ops_transaction_asset_id_tbl_entity_asset_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_transaction" RENAME CONSTRAINT "transaction_actor_id_user_id_fk" TO "tbl_ops_transaction_actor_id_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_event_log" RENAME CONSTRAINT "event_log_tenant_id_tenant_id_fk" TO "tbl_ops_event_log_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_channel" RENAME CONSTRAINT "channel_tenant_id_tenant_id_fk" TO "tbl_ops_channel_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_message" RENAME CONSTRAINT "message_tenant_id_tenant_id_fk" TO "tbl_ops_message_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_message" RENAME CONSTRAINT "message_channel_id_channel_id_fk" TO "tbl_ops_message_channel_id_tbl_ops_channel_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_message" RENAME CONSTRAINT "message_author_user_id_user_id_fk" TO "tbl_ops_message_author_user_id_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_message" RENAME CONSTRAINT "message_author_employee_id_employee_id_fk" TO "tbl_ops_message_author_employee_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_message" RENAME CONSTRAINT "message_handled_by_user_id_user_id_fk" TO "tbl_ops_message_handled_by_user_id_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_task" RENAME CONSTRAINT "task_tenant_id_tenant_id_fk" TO "tbl_ops_task_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_task" RENAME CONSTRAINT "task_assigned_to_employee_id_employee_id_fk" TO "tbl_ops_task_assigned_to_employee_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_task" RENAME CONSTRAINT "task_created_by_user_id_user_id_fk" TO "tbl_ops_task_created_by_user_id_tbl_entity_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_task" RENAME CONSTRAINT "task_related_asset_id_asset_id_fk" TO "tbl_ops_task_related_asset_id_tbl_entity_asset_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_task" RENAME CONSTRAINT "task_related_project_id_project_id_fk" TO "tbl_ops_task_related_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_ops_task" RENAME CONSTRAINT "task_requested_by_employee_id_employee_id_fk" TO "tbl_ops_task_requested_by_employee_id_tbl_entity_employee_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_project_group" RENAME CONSTRAINT "project_group_tenant_id_tenant_id_fk" TO "tbl_entity_project_group_tenant_id_tbl_entity_tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_project_group_project" RENAME CONSTRAINT "project_group_project_project_group_id_project_group_id_fk" TO "tbl_entity_project_group_project_project_group_id_tbl_entity_project_group_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_project_group_project" RENAME CONSTRAINT "project_group_project_project_id_project_id_fk" TO "tbl_entity_project_group_project_project_id_tbl_entity_project_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_project_group_user" RENAME CONSTRAINT "project_group_user_project_group_id_project_group_id_fk" TO "tbl_entity_project_group_user_project_group_id_tbl_entity_project_group_id_fk";
--> statement-breakpoint
ALTER TABLE "tbl_entity_project_group_user" RENAME CONSTRAINT "project_group_user_user_id_user_id_fk" TO "tbl_entity_project_group_user_user_id_tbl_entity_user_id_fk";
