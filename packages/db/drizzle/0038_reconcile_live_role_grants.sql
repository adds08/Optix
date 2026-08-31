-- ---------------------------------------------------------------------------
-- The live database's role grants, reconciled with the permission list in code.
--
-- Two failures, one migration, because they have one cause: `permission`,
-- `role` and `role_permission` are written by the SEED, the seed only runs
-- against a fresh database, and Urban's was seeded once on 2026-07-28
-- (e87ba98, "…and first deployment"). Every change to `PERMISSIONS` since then
-- has reached every dev machine and none of production. 0020 and 0025 each
-- patched one symptom of this; neither closed the class.
--
-- ---------------------------------------------------------------------------
-- 1. Retire `rental.read` and `rental.manage`.
-- ---------------------------------------------------------------------------
-- Both were added in e87ba98 and removed from `PERMISSIONS` in 9907416
-- (2026-08-10, "rentals and loans removed") with nothing to delete the rows.
-- `role-perms.ts` grants `owner: [...PERMISSIONS]`, so on the live database
-- owner, equipment_admin and warehouse still hold grants naming permissions
-- the code no longer has.
--
-- That is not cosmetic — it deadlocks the Roles screen. `role.list` returns
-- grants raw from this table; the page seeds its draft from that set; the
-- catalogue renders from PERMISSION_GROUPS in code, so a retired name gets no
-- checkbox and cannot be unticked; Save posts it back into
-- `z.array(permissionEnum)`, which rejects it. The tRPC formatter nulls
-- `userMessage` for a non-custom Zod issue, so the screen shows only "Could
-- not save those permissions." — for those three roles, on every save, since
-- 2026-08-10. Deleting the rows is what actually unblocks it; the filter added
-- to `role.list` in the same change is what stops the NEXT retired permission
-- doing this again.
--
-- `role_permission` first: it has an FK to `permission.name`. ON DELETE CASCADE
-- would do it, but stating both makes the intent readable and the file safe to
-- re-run against a database where only one half landed.
DELETE FROM "tbl_entity_role_permission"
  WHERE "permission_name" IN ('rental.read', 'rental.manage');

DELETE FROM "tbl_entity_permission"
  WHERE "name" IN ('rental.read', 'rental.manage');

-- ---------------------------------------------------------------------------
-- 2. Give `owner` and `equipment_admin` every permission, as role-perms.ts says.
-- ---------------------------------------------------------------------------
-- `role-perms.ts` defines both as `[...PERMISSIONS]` — literally the whole
-- list. A spread only reaches a freshly seeded database, so on the live one
-- both sit at 26 real grants against a 33-entry list. What they are missing
-- includes all four project-team permissions: `project.team.read` and
-- `project.assign.pm` are granted to `office_admin` alone, and
-- `project.assign.superintendent` and `project.assign.foreman` are granted to
-- NOBODY, because 0020 inserted the permission rows but its owner /
-- equipment_admin backfill covers only the four `assets.view.*` scopes.
--
-- The visible consequence: jobsites/page.tsx gates "+ PM", "+ SUP" and
-- "+ Add crew" on exactly those three, so the owner account — the only active
-- login in production — cannot put anyone on a project team. It could not fix
-- itself either, because section 1 above was breaking the screen that grants
-- permissions.
--
-- Selected FROM `tbl_entity_permission` rather than listing today's four, so
-- this states the same rule the spread does and self-corrects for anything
-- added to `PERMISSIONS` before it runs. It must follow section 1 or it would
-- re-grant the rental rows it just deleted.
--
-- Deliberately only these two roles. Every other role has an explicit list in
-- role-perms.ts, and — since the Roles screen shipped — the live database is
-- SUPPOSED to differ from that file wherever an administrator has edited it.
-- Reconciling the rest would silently overwrite decisions Urban made on
-- purpose. `[...PERMISSIONS]` is the one grant that cannot have been an edit.
INSERT INTO "tbl_entity_role_permission" ("role_id", "permission_name")
SELECT r."id", p."name"
FROM "tbl_entity_role" r
CROSS JOIN "tbl_entity_permission" p
WHERE r."name" IN ('owner', 'equipment_admin')
ON CONFLICT ("role_id", "permission_name") DO NOTHING;
