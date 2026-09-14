--
-- `tbl_entity_vehicle` becomes `tbl_entity_equipment`.
--
-- The client's words, 2026-09-14: "equipment table not vehicle table." The UI
-- has said "Equipment" since 2026-08-27, so the table and every screen had
-- disagreed about what this holds for weeks. It is trucks, trailers and
-- whatever plant comes later — equipment. Small tools are a different table.
--
-- A RENAME, not a copy. Postgres updates every dependent object itself:
-- indexes, the four composite foreign keys behind custody, the CHECK
-- constraints and the sequence defaults all follow. Verified on a throwaway
-- database before writing this — `assignment_truck_fk` came out reading
-- `REFERENCES tbl_entity_equipment(id, vehicle_type)` with no help.
--
-- `vehicle_type` KEEPS ITS NAME and is deliberately not renamed with the
-- table. `assignment.truck_id`/`trailer_id` and `transfer.to_truck_id`/
-- `to_trailer_id` reference `(id, vehicle_type)` through composite FKs with a
-- generated constant — the only way a plain FK can insist that a truckId names
-- a truck — and migration 0073 constrains it to exactly `truck` and `trailer`.
-- Renaming the column would mean rewriting four constraints for no gain.
--
-- The constraint NAMES are renamed too. Leaving `vehicle_equipment_class_check`
-- on a table called equipment is the kind of half-done rename that makes the
-- next reader wonder which name is current.

ALTER TABLE "tbl_entity_vehicle" RENAME TO "tbl_entity_equipment";

ALTER TABLE "tbl_entity_equipment"
  RENAME CONSTRAINT "vehicle_equipment_class_check" TO "equipment_class_check";
ALTER TABLE "tbl_entity_equipment"
  RENAME CONSTRAINT "vehicle_ownership_type_check" TO "equipment_ownership_type_check";
ALTER TABLE "tbl_entity_equipment"
  RENAME CONSTRAINT "vehicle_vehicle_type_check" TO "equipment_vehicle_type_check";
