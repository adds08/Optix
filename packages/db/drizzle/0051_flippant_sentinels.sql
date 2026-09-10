ALTER TABLE "tbl_entity_role" ADD COLUMN "onboarding_kind" text DEFAULT 'equipment' NOT NULL;--> statement-breakpoint
ALTER TABLE "tbl_entity_role" ADD COLUMN "is_cross_tenant" boolean DEFAULT false NOT NULL;--> statement-breakpoint
/*
  The two statements above only give live databases the COLUMNS. Everything
  below gives them the VALUES, because the seed runs on fresh databases only —
  `.claude/rules/database.md` records three separate migrations that exist
  solely to repair that gap, and this is the fourth avoided.

  Urban's production database was seeded 2026-07-28 and has never seen any of
  this.
*/

/* Roles whose people are not describing a crew: they get no wizard. Named
   rather than defaulted, because the column default is `equipment` and that is
   the right answer for every role NOT in this list. */
UPDATE "tbl_entity_role" SET "onboarding_kind" = 'none'
 WHERE "name" IN ('owner', 'office_admin', 'procurement', 'finance', 'read_only');
--> statement-breakpoint
/* HR sees people and no tools — the client's own division of the product. */
UPDATE "tbl_entity_role" SET "onboarding_kind" = 'people' WHERE "name" = 'hr';
--> statement-breakpoint

/*
  The technical administrator, one row per tenant.

  `is_system` so it cannot be renamed out from under `role-perms.ts`, and
  `is_cross_tenant` because that — not a larger grant — is what makes it
  different from `owner`. Nothing reads that flag yet; see the column comment.

  ON CONFLICT so re-running against a database that already has it is a no-op
  rather than a failure.
*/
INSERT INTO "tbl_entity_role"
  ("tenant_id", "name", "description", "needs_login", "can_hold_custody",
   "uses_field_layout", "onboarding_kind", "is_cross_tenant", "is_system")
SELECT t."id",
       'tech_admin',
       'Optix technical administrator. Supports every tenant; not the customer''s own administrator.',
       true, false, false, 'none', true, true
  FROM "tbl_entity_tenant" t
ON CONFLICT DO NOTHING;
--> statement-breakpoint

/*
  Its grants: EVERY permission, written as a SELECT over the permission table
  rather than as that day's hard-coded list. `role-perms.ts` says
  `tech_admin: [...PERMISSIONS]`, a spread evaluated at seed time — so the
  statement that reproduces it must also be a spread, or the two disagree the
  moment somebody adds a permission.
*/
INSERT INTO "tbl_entity_role_permission" ("role_id", "permission_name")
SELECT r."id", p."name"
  FROM "tbl_entity_role" r
 CROSS JOIN "tbl_entity_permission" p
 WHERE r."name" = 'tech_admin'
ON CONFLICT DO NOTHING;
