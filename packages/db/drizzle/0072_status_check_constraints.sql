--
-- CHECK constraints on the closed vocabularies.
--
-- Before this migration the database had ZERO check constraints. Every status,
-- type and kind column was plain `text`, and the only thing standing between a
-- typo and the register was a Zod enum at the router edge — where it existed.
-- An audit on 2026-09-14 found it often did not: `location.type` took
-- `z.string()` on create, `employee.employment_status` took `z.string()` on two
-- procedures. Any string up to the column width could be written and nothing
-- would notice until a screen rendered a status no branch handled.
--
-- The repo's rule (`.claude/rules/database.md`) says enums are not Postgres
-- enums and validation belongs at the router edge. That rule is kept: these are
-- CHECK constraints, not enum TYPES. A Postgres enum needs a migration and an
-- exclusive lock to add a value; a CHECK is a predicate, and the text column
-- keeps every property the rule wanted from it. The edge validation stays where
-- it is and stays the thing that produces a readable error — this is the floor
-- underneath it, for the writers that never passed an edge at all: an import,
-- a worker, a fixture inserting directly, a hand-run UPDATE at 2am.
--
-- EVERY value below was verified against the live data in both databases before
-- being written here; no constraint in this file would have failed on a row
-- that already existed.
--
-- WHAT IS DELIBERATELY NOT CONSTRAINED, and why each one would be a mistake:
--
--   tbl_ops_project_team_member.role   DYNAMIC. Tenant-created tiers, edited on
--       the Job Tiers screen; `projectTeam.ts` validates against the tenant's
--       own register at runtime precisely so adding a tier needs no deploy.
--       Urban added director, area_in_charge and general_superintendent as DATA
--       on 2026-09-10. A CHECK would make the next one need a migration and
--       destroy the feature.
--   tbl_entity_employee.role           LEGACY and abandoned (schema/employee.ts
--       says so: "Read `roleId`. Do not add a new reader."). It is known to
--       hold values outside its own nominal list — `crew` among them.
--   tbl_ops_event_log.source           Best-effort audit table, never the system
--       of record. A rejected audit insert would abort the real business
--       transaction that triggered it: strictly worse than a wrong label.
--   tbl_entity_vehicle.vehicle_type    NEEDS A PRODUCT DECISION. Two
--       authoritative sources contradict each other: `types/enums.ts` calls
--       truck/trailer load-bearing literals (the assignment composite FKs
--       depend on them), while `schema/location.ts` documented this column as
--       holding an arbitrary plant type when equipment_class = 'heavy'.
--
--       *** RESOLVED THE SAME DAY BY MIGRATION 0073 — this column IS
--       constrained, and the exemption list above is three columns, not four.
--       The contradiction was settled by enumerating the WRITERS rather than
--       weighing the two comments: all four (vehicle.create, vehicle.update,
--       the CSV importer, provisioning) bind to VEHICLE_TYPES, so no plant type
--       has ever been writable. The `schema/location.ts` comment cited above
--       was the stale one and has been corrected, so it no longer says what it
--       is quoted here as saying. The fear below — that constraining it would
--       close the door on heavy plant — was disproven: heavy plant is
--       `equipment_class`, which nothing references and stays open. ***
--
--       Left open here only because the question was still open when this file
--       was written. Corrected in place rather than left to mislead: an applied
--       migration is normally immutable, but this is a comment-only edit to the
--       file a reader opens to learn which columns are enforced.
--
-- NULL passes a CHECK by definition, so nullable columns keep being nullable.
-- Where null is MEANINGFUL it is noted below.

-- ---- entities ----

ALTER TABLE "tbl_entity_asset" ADD CONSTRAINT "asset_current_status_check"
  CHECK ("current_status" IN (
    'requested','approved','on_order','received','available','reserved','assigned',
    'in_transit','in_maintenance','diagnosing','waiting_parts','ready_for_pickup',
    'lost','disposed'
  ));

ALTER TABLE "tbl_entity_auth_token" ADD CONSTRAINT "auth_token_kind_check"
  CHECK ("kind" IN ('invite','reset'));

-- Four values, not the three the schema comment claims: `inactive` IS written,
-- by routers/project.ts. EMPLOYMENT_STATUSES is the authority.
ALTER TABLE "tbl_entity_employee" ADD CONSTRAINT "employee_employment_status_check"
  CHECK ("employment_status" IN ('active','inactive','terminated','on_leave'));

ALTER TABLE "tbl_entity_employee_contact" ADD CONSTRAINT "employee_contact_kind_check"
  CHECK ("kind" IN ('mobile','work','personal','home','other'));

ALTER TABLE "tbl_entity_location" ADD CONSTRAINT "location_type_check"
  CHECK ("type" IN ('warehouse','site_container','gang_box','vehicle','project_site'));

ALTER TABLE "tbl_entity_project" ADD CONSTRAINT "project_kind_check"
  CHECK ("kind" IN ('project','yard'));

ALTER TABLE "tbl_entity_project" ADD CONSTRAINT "project_status_check"
  CHECK ("status" IN ('not_awarded','awarded','in_progress','completed','cancelled','on_hold'));

ALTER TABLE "tbl_entity_vehicle" ADD CONSTRAINT "vehicle_equipment_class_check"
  CHECK ("equipment_class" IN ('vehicle','attachment','heavy','other'));

ALTER TABLE "tbl_entity_vehicle" ADD CONSTRAINT "vehicle_ownership_type_check"
  CHECK ("ownership_type" IN ('company_owned','personal_allowance'));

-- ---- operations ----

ALTER TABLE "tbl_ops_channel" ADD CONSTRAINT "channel_kind_check"
  CHECK ("kind" IN ('department','role_group'));

ALTER TABLE "tbl_ops_message" ADD CONSTRAINT "message_processing_status_check"
  CHECK ("processing_status" IN (
    'queued','processing','parsed','pending_manual','action_proposed',
    'action_executed','action_requested','error','dismissed'
  ));

ALTER TABLE "tbl_ops_notification" ADD CONSTRAINT "notification_channel_check"
  CHECK ("channel" IN ('in_app','email','sms'));

-- The list corrected on 2026-09-13, which REMOVED overdue, maintenance_due,
-- clearance_required and missing (no writers, dead with the borrow model).
-- Verified: no row in either database carries one.
ALTER TABLE "tbl_ops_notification" ADD CONSTRAINT "notification_type_check"
  CHECK ("type" IN (
    'approval_pending','custody_discrepancy','request_pending',
    'request_overdue','request_approved','request_declined'
  ));

-- `manual_entry`, and note this is NOT the same vocabulary as tbl_ops_task.source
-- below. Two columns of the same name, disjoint value sets.
ALTER TABLE "tbl_ops_project_team_member" ADD CONSTRAINT "project_team_member_source_check"
  CHECK ("source" IN ('equipment_department','payroll_import','manual_entry','api_sync','onboarding'));

-- `overdue` has no writer (borrow model removed 2026-08-09) but is KEPT: a
-- pre-removal row may still carry it, and history must keep rendering.
ALTER TABLE "tbl_ops_smalltools_custody" ADD CONSTRAINT "custody_status_check"
  CHECK ("status" IN ('active','returned','transferred','overdue','pending_approval','cancelled'));

ALTER TABLE "tbl_ops_sync_run" ADD CONSTRAINT "sync_run_source_check"
  CHECK ("source" IN ('bamboohr'));

ALTER TABLE "tbl_ops_sync_run" ADD CONSTRAINT "sync_run_status_check"
  CHECK ("status" IN ('queued','running','done','failed'));

-- NULL is meaningful here and passes: routers/inbox.ts reads
-- `classification IS NULL AND action_type IS NOT NULL` as "recognized, not yet
-- swept". Only 'completed' currently has a writer.
ALTER TABLE "tbl_ops_task" ADD CONSTRAINT "task_classification_check"
  CHECK ("classification" IN ('recognized','completed','unrecognized'));

ALTER TABLE "tbl_ops_task" ADD CONSTRAINT "task_priority_check"
  CHECK ("priority" IN ('low','medium','high','urgent'));

-- `manual`, NOT `manual_entry`. See project_team_member.source above.
ALTER TABLE "tbl_ops_task" ADD CONSTRAINT "task_source_check"
  CHECK ("source" IN ('chat','manual'));

ALTER TABLE "tbl_ops_task" ADD CONSTRAINT "task_status_check"
  CHECK ("status" IN ('pending','in_progress','completed','cancelled'));

-- `pending_verification` is HISTORICAL ONLY — no writer may produce it, and it
-- stays so a pre-2026-08-09 transfer row still renders.
ALTER TABLE "tbl_ops_transfer" ADD CONSTRAINT "transfer_status_check"
  CHECK ("status" IN (
    'pending_approval','pending_verification','approved','in_transit','completed','cancelled'
  ));
