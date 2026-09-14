--
-- Remove `gang_box` and `site_container` from the location vocabulary.
--
-- The client's direction, 2026-09-14: "project is being done in a location, and
-- small tools are contained within a trailer assigned to a foreman and attached
-- to a truck, foreman works in a project, that's all... if it is in with
-- equipment department it goes to yard project, simple as that!"
--
-- So three places a tool can sit, and each answers a different question:
--   warehouse     the yard
--   vehicle       a truck or trailer (these rows are created by the vehicle
--                 importer, never by hand)
--   project_site  a job
--
-- SAFE, and checked rather than assumed. Neither removed value was ever used:
-- the recovered data was one warehouse plus 31 vehicle mirrors, and both
-- databases held ZERO location rows when this was written. Nothing in the
-- custody logic branched on them either — only `vehicle` is special-cased
-- (routers/location.ts), so the other values are interchangeable labels to
-- every code path that reads this column.
--
-- The UPDATE below is therefore expected to touch nothing here. It is written
-- anyway because this migration will also run against the production database,
-- where a row somebody created by hand would otherwise abort the whole
-- migration — and on boot, since the API migrates before it serves. Mapping to
-- `warehouse` is the honest fallback: a gang box IS a place in the yard.

UPDATE "tbl_entity_location"
   SET "type" = 'warehouse'
 WHERE "type" IN ('gang_box', 'site_container');

ALTER TABLE "tbl_entity_location" DROP CONSTRAINT IF EXISTS "location_type_check";

ALTER TABLE "tbl_entity_location" ADD CONSTRAINT "location_type_check"
  CHECK ("type" IN ('warehouse', 'vehicle', 'project_site'));
