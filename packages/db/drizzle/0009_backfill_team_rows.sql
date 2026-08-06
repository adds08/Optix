-- Backfill project_team_member from open job postings.
--
-- 0008 added the team roster and project.list started being scoped by it, so
-- on an existing deployment every non-project.manage user would go from "all
-- projects" to an empty list the moment the API booted — there were no team
-- rows yet. The one data source that already answers "who works where" is the
-- open posting (employee_project_assignment.ended_on IS NULL), so this lifts
-- those into the roster for the roles the team module knows (pm,
-- superintendent, foreman). Idempotent: the NOT EXISTS guard skips people who
-- already have an active row (from the seed or from project.team.assign).
INSERT INTO "project_team_member"
  ("tenant_id", "project_id", "employee_id", "role", "assigned_by_user_id",
   "started_on", "ended_on", "note")
SELECT
  epa."tenant_id",
  epa."project_id",
  epa."employee_id",
  e."role",
  NULL,
  epa."started_on",
  NULL,
  'Backfilled from open posting (migration 0009)'
FROM "employee_project_assignment" epa
JOIN "employee" e
  ON e."id" = epa."employee_id"
 AND e."tenant_id" = epa."tenant_id"
WHERE epa."ended_on" IS NULL
  AND e."role" IN ('pm', 'superintendent', 'foreman')
  AND NOT EXISTS (
    SELECT 1 FROM "project_team_member" ptm
    WHERE ptm."tenant_id" = epa."tenant_id"
      AND ptm."project_id" = epa."project_id"
      AND ptm."employee_id" = epa."employee_id"
      AND ptm."role" = e."role"
      AND ptm."ended_on" IS NULL
  );
