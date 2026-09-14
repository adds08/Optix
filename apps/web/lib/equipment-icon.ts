import { Box, Caravan, Truck, Wrench, type LucideIcon } from "lucide-react";
import { EQUIPMENT_CLASS_LABELS, type EquipmentClass } from "@optix/types";

/*
  Which glyph the register draws for an equipment class, and what it is called.

  ONE definition, because there were two: the register page and the detail page
  each carried `equipmentClass === "heavy" ? Wrench : Truck` inline. That was
  correct while the vocabulary had exactly two values, and silently wrong the
  moment it gained `attachment` and `other` — both would have drawn a truck, on
  two pages, and nothing would have failed. The same drift this codebase already
  paid for with three custodian pickers.

  Falls back rather than throwing on an unknown value. The premise used to be
  that the column was unconstrained; since migration 0072 `equipment_class` is
  CHECK-constrained to exactly these four, so an unknown value should now be
  unreachable from the database. The fallback stays as the belt to those
  braces: it keeps the register rendering rather than crashing a page on a
  value added to the enum before somebody adds it to this map.
*/
const ICONS: Record<EquipmentClass, LucideIcon> = {
  vehicle: Truck,
  attachment: Caravan,
  heavy: Wrench,
  other: Box,
};

export function equipmentIcon(equipmentClass: string | null | undefined): LucideIcon {
  return ICONS[equipmentClass as EquipmentClass] ?? Truck;
}

export function equipmentClassLabel(equipmentClass: string | null | undefined): string {
  return EQUIPMENT_CLASS_LABELS[equipmentClass as EquipmentClass] ?? "Vehicle";
}
