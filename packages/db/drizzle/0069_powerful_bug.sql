ALTER TABLE "tbl_entity_role" ADD COLUMN "category" text;--> statement-breakpoint
-- Seed the operational category — what `employee.role` used to answer, now read
-- off the role register instead. Only the roles the old nine-value enum had a
-- name for get one; crew, director, area_in_charge, general_superintendent,
-- engineer and read_only are left null on purpose (see identity.ts's comment).
--
-- Matched on `name` ALONE, deliberately, and not on `tenant_id IS NULL`. The
-- first cut of this migration scoped to system roles and would have updated
-- exactly nothing: there are no system roles in either database. Every role is
-- tenant-scoped — 58 rows across three tenants in dev, all 18 of Urban's in
-- production, `tenant_id IS NULL` matching zero of them. It would have applied
-- green and left the column entirely null, which is the "a migration that looks
-- like success while writing nothing" failure this repo has already paid for
-- three times (see .claude/rules/database.md). Checked against both databases
-- before widening.
UPDATE "tbl_entity_role" SET "category" = CASE "name"
  WHEN 'foreman' THEN 'foreman'
  WHEN 'mechanic' THEN 'mechanic'
  WHEN 'project_manager' THEN 'pm'
  WHEN 'equipment_admin' THEN 'equipment_admin'
  WHEN 'warehouse' THEN 'warehouse'
  WHEN 'procurement' THEN 'procurement'
  WHEN 'hr' THEN 'hr'
  WHEN 'finance' THEN 'finance'
  WHEN 'superintendent' THEN 'superintendent'
END
WHERE "name" IN (
  'foreman', 'mechanic', 'project_manager', 'equipment_admin', 'warehouse',
  'procurement', 'hr', 'finance', 'superintendent'
);
