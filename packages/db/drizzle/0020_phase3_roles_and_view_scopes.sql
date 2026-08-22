-- Phase 3 (STI-302 / STI-304 / STI-308): the new permissions, the new roles,
-- and the visibility tier every EXISTING role now needs.
--
-- Why this migration has to exist at all.
--
-- `permission`, `role` and `role_permission` are populated by the SEED, and the
-- seed only ever runs against a fresh database — it refuses to touch a tenant
-- that already exists unless SEED_RESET=1 wipes it. So on Urban's live database
-- none of the four `assets.view.*` rows would exist, no role would be granted
-- one, and `viewTierOf` (packages/api-contracts/src/scope.ts) resolves an actor
-- holding none of them to tier "none" — which is deliberately an EMPTY result,
-- never an unscoped one.
--
-- Deploying Phase 3 without this migration therefore does not degrade
-- gracefully. It shows every user in the company an empty register, an empty
-- dashboard and empty reports, on the first request after the API restarts.
--
-- This is the same failure 0009 was written for: 0008 started scoping
-- project.list by a roster table that had no rows yet, so every scoped user
-- went to "no projects" the moment the API booted. Same shape, wider blast
-- radius — that one hid jobs, this one would hide the entire tool fleet.
--
-- Idempotent throughout: ON CONFLICT DO NOTHING and NOT EXISTS guards, so it is
-- safe to re-run and safe on a database the seed has already populated.

-- ---------------------------------------------------------------------------
-- 1. The permission rows themselves.
-- ---------------------------------------------------------------------------
-- `permission` is a GLOBAL table (no tenant_id) — see the note at the end of
-- this file. These four are the visibility ladder from SYSTEM_PLAN §6.3.
INSERT INTO "permission" ("name", "description") VALUES
  ('assets.view.all',     'See every tool in the tenant'),
  ('assets.view.project', 'See tools on the projects you are on the team of'),
  ('assets.view.crew',    'See tools held by the foremen reporting to you'),
  ('assets.view.own',     'See only the tools in your own custody')
ON CONFLICT ("name") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The three new login roles, per tenant.
-- ---------------------------------------------------------------------------
-- `system_admin` is deliberately NOT among them: `owner` already holds every
-- permission and already does that job, and a second all-permissions role is
-- two names for one authority — the "'Admin' means three things" ambiguity
-- SYSTEM_PLAN §2 forbids. See docs/workings/PERMISSION_MATRIX.md.
--
-- One row per existing tenant. `role.tenant_id` is nullable (null = a system
-- role shared by all tenants) but these are per-tenant, matching how the seed
-- writes the other ten.
INSERT INTO "role" ("tenant_id", "name", "description")
SELECT t."id", r."name", r."description"
FROM "tenant" t
CROSS JOIN (VALUES
  ('office_admin', 'Office Administrator — business records, not custody and not platform config'),
  ('engineer',     'Engineer — a Project Manager''s authority over small tools'),
  ('mechanic',     'Mechanic — holds and uses tools for repair, charged to the department')
) AS r("name", "description")
WHERE NOT EXISTS (
  SELECT 1 FROM "role" existing
  WHERE existing."tenant_id" = t."id" AND existing."name" = r."name"
);

-- ---------------------------------------------------------------------------
-- 3. The visibility tier for every role, new and existing.
-- ---------------------------------------------------------------------------
-- This is the half that matters on an existing database: the ten roles that
-- were already there have no tier, and without one they see nothing.
--
-- The mapping is the one in packages/db/src/role-perms.ts. STI-308's matrix
-- test asserts the database matches that file in both directions, so if these
-- two ever disagree the build fails rather than a user quietly seeing the
-- wrong slice of the register.
INSERT INTO "role_permission" ("role_id", "permission_name")
SELECT r."id", m."permission_name"
FROM "role" r
JOIN (VALUES
  -- Everything in the tenant: the desk, the admins, the back office.
  --
  -- `owner` and `equipment_admin` take ALL FOUR, not just `assets.view.all`.
  -- That looks redundant and is not: role-perms.ts grants them `[...PERMISSIONS]`
  -- — literally every permission — so granting them one scope here would leave
  -- the migrated database three rows short of a seeded one. Functionally the
  -- two are identical (first-match-wins resolves both to `all`), but STI-308
  -- asserts the database matches role-perms.ts EXACTLY in both directions, and
  -- a migration that produces a different database from the seed is a
  -- production that behaves differently from every dev machine. The test
  -- caught this; it was written to.
  ('owner',           'assets.view.all'),
  ('owner',           'assets.view.project'),
  ('owner',           'assets.view.crew'),
  ('owner',           'assets.view.own'),
  ('equipment_admin', 'assets.view.all'),
  ('equipment_admin', 'assets.view.project'),
  ('equipment_admin', 'assets.view.crew'),
  ('equipment_admin', 'assets.view.own'),
  ('office_admin',    'assets.view.all'),
  ('warehouse',       'assets.view.all'),
  ('procurement',     'assets.view.all'),
  ('hr',              'assets.view.all'),
  ('finance',         'assets.view.all'),
  ('read_only',       'assets.view.all'),
  -- Their projects' tools.
  ('project_manager', 'assets.view.project'),
  ('engineer',        'assets.view.project'),
  -- The foremen reporting to them, and themselves.
  ('superintendent',  'assets.view.crew'),
  -- What is in their own hands.
  ('foreman',         'assets.view.own'),
  ('mechanic',        'assets.view.own')
) AS m("role_name", "permission_name")
  ON m."role_name" = r."name"
ON CONFLICT ("role_id", "permission_name") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. The permission sets for the three new roles.
-- ---------------------------------------------------------------------------
-- `engineer` is `project_manager`'s set, by construction rather than by copy —
-- selected FROM the existing role so the two cannot drift here even though the
-- values are written out in role-perms.ts.
INSERT INTO "role_permission" ("role_id", "permission_name")
SELECT eng."id", rp."permission_name"
FROM "role" eng
JOIN "role" pm
  ON pm."name" = 'project_manager'
 AND pm."tenant_id" IS NOT DISTINCT FROM eng."tenant_id"
JOIN "role_permission" rp ON rp."role_id" = pm."id"
WHERE eng."name" = 'engineer'
ON CONFLICT ("role_id", "permission_name") DO NOTHING;

-- Office Administrator: business records. Deliberately WITHOUT `config.manage`
-- — that grant also carries the LLM configuration and the high-value approval
-- threshold, and "may add a user" is not the same authority as "may change what
-- needs a second signature" (PERMISSION_MATRIX §5 decision 4, default taken).
-- Consequence: an Office Administrator cannot create users or reset passwords.
INSERT INTO "role_permission" ("role_id", "permission_name")
SELECT r."id", p."permission_name"
FROM "role" r
CROSS JOIN (VALUES
  ('asset.read'), ('assignment.read'), ('transfer.read'),
  ('location.read'), ('vehicle.read'),
  ('project.read'), ('project.manage'), ('project.team.read'),
  ('project.assign.pm'),
  ('employee.read'), ('employee.manage'),
  ('department.read'), ('report.read'), ('audit.read'), ('notification.read')
) AS p("permission_name")
WHERE r."name" = 'office_admin'
ON CONFLICT ("role_id", "permission_name") DO NOTHING;

-- Mechanic: a custodian like a foreman, but for repair rather than
-- construction. No `project.read` — a mechanic works out of the yard and their
-- custody charges the Equipment DEPARTMENT, which is why `department.read` is
-- here instead.
INSERT INTO "role_permission" ("role_id", "permission_name")
SELECT r."id", p."permission_name"
FROM "role" r
CROSS JOIN (VALUES
  ('asset.read'), ('location.read'), ('vehicle.read'),
  ('employee.read'), ('department.read'),
  ('assignment.read'), ('transfer.read'),
  ('report.read'), ('notification.read')
) AS p("permission_name")
WHERE r."name" = 'mechanic'
ON CONFLICT ("role_id", "permission_name") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Two grants the matrix reconciliation added to existing roles.
-- ---------------------------------------------------------------------------
-- `notification.read` is granted to all thirteen roles in
-- PERMISSION_MATRIX.md §2 and the seed had simply never been filled in for
-- several of them — an omission, not a decision, so it is granted here too.
-- Everything else where the shipped seed and the matrix disagreed was left as
-- shipped (CLAUDE.md rule 3); see PERMISSION_MATRIX.md §4.
INSERT INTO "role_permission" ("role_id", "permission_name")
SELECT r."id", 'notification.read'
FROM "role" r
WHERE r."name" IN ('procurement', 'project_manager', 'finance', 'read_only')
ON CONFLICT ("role_id", "permission_name") DO NOTHING;

-- `project_manager` gained the four read permissions its scope tier implies:
-- a PM who may see their projects' tools must be able to read a tool, an
-- assignment, a transfer, a location and a vehicle to see anything at all.
INSERT INTO "role_permission" ("role_id", "permission_name")
SELECT r."id", p."permission_name"
FROM "role" r
CROSS JOIN (VALUES
  ('assignment.read'), ('transfer.read'), ('location.read'), ('vehicle.read')
) AS p("permission_name")
WHERE r."name" = 'project_manager'
ON CONFLICT ("role_id", "permission_name") DO NOTHING;

-- ---------------------------------------------------------------------------
-- On `tenant_id`, since this migration writes to three tables and only one of
-- them has the column (PR #6 review).
-- ---------------------------------------------------------------------------
-- `permission` is global: a permission name means the same thing in every
-- tenant, and tenanting it would let two tenants disagree about what
-- `asset.manage` means. `role_permission` and `user_role` are join tables whose
-- tenant is carried by their parents (`role.tenant_id`, `user.tenant_id`) —
-- adding a fourth copy of the same fact is a way for it to disagree with
-- itself, not extra isolation. `role` IS tenant-scoped, because a tenant may
-- name a role of its own; `role.tenant_id` is nullable, and null means a system
-- role shared by all tenants.
--
-- Those four tables are the complete list of tables without `tenant_id`, and
-- each is deliberate. See docs/02-saas-architecture.md §5.
