--
-- Empty the register, keep the ability to sign in.
--
-- Run by `make reset-bare`. Asked for by the user on 2026-09-07 after a
-- half-finished BambooHR sync left 602 employees where 83 belonged: `make reset`
-- reseeds a full dataset, which is the wrong tool when what you want is to start
-- from nothing and pull the real roster in over the top.
--
-- WHAT SURVIVES, and each for a reason:
--   tenant, permission, role, role_permission, user, user_role
--       Without these nobody can sign in and nothing can be authorised. The
--       point of this script is an empty register you can still USE.
--   tenant_settings, tenant_feature
--       Configuration, not data. The high-value threshold and which modules are
--       on are not things a roster reload should reset.
--   category, uom_category, unit_of_measure, team_role
--       Static vocabularies shared by every dataset — `seed.ts` says a category
--       and a unit of measure mean the same thing whichever register is loaded.
--   asset_model, manufacturer
--       Vestigial; nothing reads or writes them (see schema/asset.ts). Left
--       alone rather than tidied by a script whose job is something else.
--
-- Everything else goes.
--
-- DELETE, NOT TRUNCATE. `TRUNCATE ... CASCADE` on this schema would reach the
-- retained tables through the FK graph and take the logins with it, which is the
-- one thing this script exists not to do. Ordered deletes make the dependencies
-- explicit and visible in review.
--
-- One transaction: a half-emptied register with orphaned custody rows is worse
-- than either a full one or an empty one.

BEGIN;

-- The ledger is append-only, enforced by trigger since 0014_append_only_ledger
-- (STI-104). Both the direct delete below and the cascade from asset would raise
-- SQLSTATE 0A000 with it armed. `seed.ts`'s own wipe is the other sanctioned
-- exception; the guard is dropped for exactly this block and re-armed below.
-- NEVER weaken the trigger itself.
ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER "transaction_no_update_delete";

-- Operational rows first: everything that points at a person, a tool or a job.
-- `project_access_restriction` leads because BOTH its foreign keys are NO
-- ACTION rather than CASCADE — a removal is a durable access decision that
-- deliberately outlives the posting it refers to (schema/team-access.ts), so
-- no cascade can ever reach it and it blocks the employee and project deletes
-- below instead. It was absent from this file until 2026-09-09 and the script
-- appeared to work only because the table happened to be empty.
DELETE FROM "tbl_ops_project_access_restriction";
DELETE FROM "tbl_ops_smalltools_custody";
DELETE FROM "tbl_ops_transfer";
DELETE FROM "tbl_ops_transaction";
DELETE FROM "tbl_ops_task";
DELETE FROM "tbl_ops_message";
DELETE FROM "tbl_ops_channel";
DELETE FROM "tbl_ops_notification";
DELETE FROM "tbl_ops_event_log";
DELETE FROM "tbl_ops_project_role_deferral";
DELETE FROM "tbl_ops_project_team_member";
DELETE FROM "tbl_ops_employee_project_assignment";
DELETE FROM "tbl_ops_user_onboarding";
DELETE FROM "tbl_ops_sync_run";

-- Then the entities themselves.
DELETE FROM "tbl_entity_asset";
DELETE FROM "tbl_entity_vehicle";
DELETE FROM "tbl_entity_location";
DELETE FROM "tbl_entity_warehouse";
DELETE FROM "tbl_entity_employee_external_ref";
DELETE FROM "tbl_entity_employee_contact";
DELETE FROM "tbl_entity_employee";
DELETE FROM "tbl_entity_project_group_project";
DELETE FROM "tbl_entity_project_group_user";
DELETE FROM "tbl_entity_project_group";
DELETE FROM "tbl_entity_project";

-- Reference data a sync creates on sight. Emptied so a fresh pull rebuilds only
-- the divisions, departments and job titles BambooHR actually reports, rather
-- than leaving behind the ones a previous dataset invented.
DELETE FROM "tbl_entity_division";
DELETE FROM "tbl_entity_department";
DELETE FROM "tbl_entity_company_role";

ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER "transaction_no_update_delete";

COMMIT;

-- What is left, for the operator's benefit.
SELECT
  (SELECT count(*) FROM "tbl_entity_user")       AS logins_kept,
  (SELECT count(*) FROM "tbl_entity_role")       AS roles_kept,
  (SELECT count(*) FROM "tbl_entity_permission") AS permissions_kept,
  (SELECT count(*) FROM "tbl_entity_employee")   AS employees,
  (SELECT count(*) FROM "tbl_entity_asset")      AS tools,
  (SELECT count(*) FROM "tbl_entity_project")    AS jobs;
