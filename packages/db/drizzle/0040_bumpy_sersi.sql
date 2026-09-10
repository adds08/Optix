ALTER TABLE "tbl_entity_vehicle" ADD COLUMN "vin" text;--> statement-breakpoint

/*
  File the existing trailers as attachments.

  `equipment_class` has existed since the register was split from small tools,
  but no form ever wrote it, so every row in every database holds the column
  default of 'vehicle' — including the trailers, which are not vehicles in the
  sense Urban means. The vocabulary gained 'attachment' and 'other' alongside
  the picker that finally sets it, and without this backfill the new category
  would be true of nothing until somebody edited forty rows by hand.

  Keyed off `vehicle_type` rather than a list of units, because that column is
  the structural fact the composite FKs already enforce: a row is a trailer
  because `assignment.trailerId` can reference it, not because of how it was
  filed. Trucks stay 'vehicle', which they already are.

  Deliberately NOT touching rows that already carry a non-default class: if
  something was filed as 'heavy' by hand or by a later import, that is a
  human's decision and this migration has nothing better to say about it.
*/
UPDATE "tbl_entity_vehicle"
   SET "equipment_class" = 'attachment'
 WHERE "vehicle_type" = 'trailer'
   AND "equipment_class" = 'vehicle';
