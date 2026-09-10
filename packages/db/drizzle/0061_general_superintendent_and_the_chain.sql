-- ---------------------------------------------------------------------------
-- Split out of 0060 rather than appended to it.
--
-- 0060 had already been applied when this was written, and Drizzle records a
-- migration by its HASH: editing an applied file means the new statements
-- never run, silently, while `migrate` still reports success. Verified — the
-- appended SQL did nothing until it moved here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- `general_superintendent`, and the Set-by chain the client drew.
--
-- Added in the same migration rather than a new one because it is the same
-- change still being described: on 2026-09-10 the client set out the full
-- chain — "directors assigns general superintendents (gsupers) & area-incharge,
-- area-incharge or gsupers assigns pm and superintendent, and hence forward".
--
-- A general superintendent CLAIMS as well as being placed, because a job may be
-- run by one with no area in-charge above them on that job.
-- ---------------------------------------------------------------------------

INSERT INTO "tbl_entity_role"
  ("tenant_id", "name", "description", "needs_login", "can_hold_custody",
   "uses_field_layout", "is_system", "onboarding_kind", "claim_tier_names")
SELECT
  t."id",
  'general_superintendent',
  'Runs an area''s superintendents. Claims their own jobs, and staffs PMs and superintendents onto them.',
  true, true, false, true, 'equipment',
  '["general_superintendent"]'::jsonb
FROM "tbl_entity_tenant" t
ON CONFLICT ("tenant_id", "name") DO NOTHING;

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
WHERE ro."name" = 'general_superintendent'
ON CONFLICT DO NOTHING;

-- The "Set by" edges, expressed as (tier filled, tier that may fill it).
-- `ON CONFLICT DO NOTHING` on the composite PK makes this re-runnable and
-- means an edge a tenant already added by hand is left exactly as it is.
INSERT INTO "tbl_entity_team_role_assigner" ("team_role_id", "assigner_team_role_id")
SELECT target."id", assigner."id"
FROM "tbl_entity_team_role" target
JOIN "tbl_entity_team_role" assigner
  ON assigner."tenant_id" = target."tenant_id"
JOIN (VALUES
  ('area_in_charge',         'director'),
  ('general_superintendent', 'director'),
  ('general_superintendent', 'area_in_charge'),
  ('pm',                     'general_superintendent')
) AS want("target", "assigner")
  ON want."target" = target."name" AND want."assigner" = assigner."name"
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Remove duplicate "Set by" rows.
--
-- The live register carried Superintendent four times on Foreman, which the
-- screen rendered as "Superintendent, Superintendent, Superintendent...". The
-- composite PK should have prevented it, so these predate the constraint.
-- Keeps one row per pair.
-- ---------------------------------------------------------------------------
DELETE FROM "tbl_entity_team_role_assigner" a
USING "tbl_entity_team_role_assigner" b
WHERE a.ctid > b.ctid
  AND a."team_role_id" = b."team_role_id"
  AND a."assigner_team_role_id" = b."assigner_team_role_id";
