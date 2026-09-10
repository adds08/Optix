-- ---------------------------------------------------------------------------
-- Take `assets.view.all` and `project.team.assign` back off the leadership
-- roles.
--
-- 0060 and 0061 granted both, reasoning that leadership must see every project
-- to claim one and must be able to place the FIRST person onto an empty job.
-- Both premises were wrong, and the client caught the symptom the same day: a
-- director on three jobs was shown all nineteen projects and 272 people on the
-- wizard's crew step, which is not what "your crew" means.
--
-- Why they are not needed:
--
--   * Either permission makes `visibleProjectScope` return UNRESTRICTED
--     (packages/api-contracts/src/scope.ts), so holding one turns "runs some
--     jobs" into "sees the whole tenant".
--   * Claiming never used the scope. `onboarding.claimOptions` queries
--     `project` directly with no scope predicate, precisely so somebody can
--     pick a job they are not on yet.
--   * Placing people does not need the tenant-wide grant. Once a director has
--     claimed a job they hold the `director` TIER on it, and `assertCanAssign`
--     reads the "Set by" rows from there. Their authority arrives with the
--     claim and stops at the jobs they took on — which is the property that
--     was missing.
--
-- Deletes only these two grants, and only from these three roles: an owner or
-- the equipment desk holding the same permissions keeps them.
-- ---------------------------------------------------------------------------
DELETE FROM "tbl_entity_role_permission" rp
USING "tbl_entity_role" r
WHERE rp."role_id" = r."id"
  AND r."name" IN ('director', 'area_in_charge', 'general_superintendent')
  AND rp."permission_name" IN ('assets.view.all', 'project.team.assign');

-- `assets.view.project` in their place: the jobs they hold a roster row on,
-- which is exactly what a claim creates.
INSERT INTO "tbl_entity_role_permission" ("role_id", "permission_name")
SELECT r."id", p."name"
FROM "tbl_entity_role" r
JOIN "tbl_entity_permission" p ON p."name" = 'assets.view.project'
WHERE r."name" IN ('director', 'area_in_charge', 'general_superintendent')
ON CONFLICT DO NOTHING;
