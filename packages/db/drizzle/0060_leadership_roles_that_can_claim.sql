-- ---------------------------------------------------------------------------
-- The leadership login roles, and the self-claim grant that unblocks
-- onboarding.
--
-- Hand-written, not generated: `role`, `role_permission` and `claim_tier_names`
-- are SEED data, and the seed only ever runs against a fresh database. Urban's
-- was seeded once, so a role added to `role-perms.ts` reaches every dev machine
-- and no live one — the class of gap that already cost migrations 0020, 0025
-- and 0038. `.claude/rules/database.md` states the rule: adding a role or a
-- permission means a migration granting it.
--
-- WHY THESE ROLES EXIST
--
-- Urban's chain is director -> area in-charge -> PM & general superintendent ->
-- superintendent -> foreman. The login roles stopped at `project_manager`, so
-- the people the client asked to invite first — three Project Directors, an
-- Area Manager, an Area Superintendent — had no role to receive, and inviting
-- one produced an account holding nothing.
--
-- WHY THEY CARRY `claim_tier_names` AND NOBODY ELSE DOES
--
-- A tenant with an empty roster is deadlocked: `assertCanAssign` grants
-- authority from the tier a person holds ON THAT PROJECT, and on a job with
-- nobody on it there is no such tier for anyone. Nothing can be placed because
-- nothing has been placed. One role able to place ITSELF breaks the circle;
-- everybody below is then placed through the ordinary "Set by" chain, which
-- Urban has already configured correctly.
--
-- This is per-tenant DATA, not a code decision — `/settings/team-roles` and
-- `/admin/roles` both edit it, and a tenant that wants a different shape can
-- have one without a deploy.
-- ---------------------------------------------------------------------------

-- 1. The first two roles, one per existing tenant. Section 3 adds the third.
--
-- `is_system` true: these are shipped roles, not something a tenant invented.
-- `onboarding_kind` 'equipment' so first login runs the wizard that offers
-- projects — 'none' would skip the very step these roles exist to reach.
INSERT INTO "tbl_entity_role"
  ("tenant_id", "name", "description", "needs_login", "can_hold_custody",
   "uses_field_layout", "is_system", "onboarding_kind", "claim_tier_names")
SELECT
  t."id",
  r."name",
  r."description",
  true,   -- needs_login
  false,  -- can_hold_custody: leadership runs jobs, it does not carry the tools
  false,  -- uses_field_layout: a desk user, not a field one
  true,   -- is_system
  'equipment',
  r."claim_tier_names"::jsonb
FROM "tbl_entity_tenant" t
CROSS JOIN (VALUES
  ('director',
   'Leads the business unit. Claims the jobs they run, then staffs them.',
   '["director"]'),
  ('area_in_charge',
   'Runs an area''s jobs. Claims their own, and places PMs and superintendents on them.',
   '["area_in_charge"]')
) AS r("name", "description", "claim_tier_names")
ON CONFLICT ("tenant_id", "name") DO NOTHING;

-- 2. Their permissions.
--
-- Selected FROM `tbl_entity_permission` rather than written as literals, so
-- this statement says the same thing the code says and cannot grant a
-- permission that does not exist. Same shape as 0038's backfill, for the same
-- reason.
--
-- The set is PM_PERMS with `assets.view.project` swapped for
-- `assets.view.all`, plus `project.team.assign` and `project.team.manage`:
--
--   * assets.view.all      — leadership must SEE every job to choose which to
--                            claim; a scope narrowed to jobs they are already
--                            on is empty at exactly the moment it matters.
--   * project.team.assign  — the tenant-wide grant. A PM deliberately does not
--                            hold it (authority comes from their tier on the
--                            job); leadership needs it because they are placing
--                            the FIRST person onto a job nobody is on yet.
--   * project.team.manage  — the Job Tiers register, so a director can describe
--                            their own chain without an owner.
--
-- Deliberately NOT `config.manage`: that carries the LLM keys and the
-- high-value approval threshold, and "runs the jobs" is not "changes what needs
-- a second signature".
INSERT INTO "tbl_entity_role_permission" ("role_id", "permission_name")
SELECT ro."id", p."name"
FROM "tbl_entity_role" ro
JOIN "tbl_entity_permission" p
  ON p."name" IN (
    'asset.read', 'project.read', 'project.manage', 'employee.read',
    'report.read', 'assignment.read', 'transfer.read', 'location.read',
    'vehicle.read', 'notification.read', 'project.team.read',
    'assets.view.all', 'project.team.assign', 'project.team.manage'
  )
WHERE ro."name" IN ('director', 'area_in_charge')
ON CONFLICT DO NOTHING;
