-- ---------------------------------------------------------------------------
-- `project_access_restriction` gains the cascades every sibling table has.
--
-- Without them a tenant cannot be deleted while a restriction row exists, so
-- `SEED_RESET` and every test teardown failed on this FK with a raw 23503 —
-- which is how orphan tenants accumulated in the shared dev database. A
-- restriction is meaningless once its tenant, project or person is gone.
-- ---------------------------------------------------------------------------
ALTER TABLE "tbl_ops_project_access_restriction"
  DROP CONSTRAINT IF EXISTS "tbl_ops_project_access_restriction_tenant_id_tbl_entity_tenant_id_fk",
  DROP CONSTRAINT IF EXISTS "tbl_ops_project_access_restriction_project_id_tbl_entity_project_id_fk",
  DROP CONSTRAINT IF EXISTS "tbl_ops_project_access_restriction_employee_id_tbl_entity_employee_id_fk";

ALTER TABLE "tbl_ops_project_access_restriction"
  ADD CONSTRAINT "tbl_ops_project_access_restriction_tenant_id_tbl_entity_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tbl_entity_tenant"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "tbl_ops_project_access_restriction_project_id_tbl_entity_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "tbl_entity_project"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "tbl_ops_project_access_restriction_employee_id_tbl_entity_employee_id_fk"
    FOREIGN KEY ("employee_id") REFERENCES "tbl_entity_employee"("id") ON DELETE CASCADE;
