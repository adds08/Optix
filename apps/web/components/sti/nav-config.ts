import type { Permission } from "@stinventory/types";
import {
  Activity,
  BarChart3,
  Boxes,
  HardHat,
  Inbox,
  LayoutDashboard,
  MapPin,
  MessageSquare,
  Radio,
  Settings,
  Truck,
  Users,
  Wrench,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm?: Permission;
  /* Shown in the field layout as a large primary action rather than a nav row. */
  hint?: string;
};

export type NavGroup = { label: string; items: NavItem[] };

/*
  Two shapes of navigation, not one list with things hidden.

  A foreman is standing in a yard holding a phone. They have exactly three jobs:
  see what they hold, hand something over, and flag a problem. Giving them the
  desk navigation with two thirds greyed out is how field software gets abandoned.

  Desk roles run the operation and need the full surface — including Reports,
  which is the product's moat and had no screen at all before this rebuild.
*/

export const FIELD_NAV: NavGroup[] = [
  {
    label: "Field",
    items: [
      { href: "/my-tools", label: "My Tools", icon: Wrench, hint: "What you are holding" },
      { href: "/chat", label: "Hand Off", icon: MessageSquare, hint: "Type it in one sentence" },
      { href: "/inbox", label: "Alerts", icon: Inbox, hint: "Overdue and requests" },
    ],
  },
];

export const DESK_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/home", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Equipment",
    items: [
      { href: "/tools", label: "Tool Register", icon: Boxes, perm: "asset.read" },
      { href: "/custody", label: "Custody", icon: Wrench, perm: "assignment.read" },
      /*
        Trucks and trailers are NOT a fleet to manage — they are locations that
        move, carrying small tools around. They belong here beside warehouses,
        site containers and gang boxes, answering "where is UIC-1012?" with
        "Truck 12". No mileage, no maintenance schedules, no driver assignment.
      */
      { href: "/locations", label: "Locations", icon: MapPin, perm: "location.read" },
      { href: "/map", label: "Fleet Map", icon: Radio, perm: "location.read" },
      /*
        Rented kit is a separate register on purpose. Urban does not own it,
        it has a return date, and it is the only equipment on the system that
        costs money simply by existing — merging it into the tool register
        would bury that.
      */
      { href: "/rentals", label: "Rented", icon: Truck, perm: "rental.read" },
    ],
  },
  {
    label: "Insight",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3, perm: "report.read" },
      { href: "/activity", label: "Activity", icon: Activity, perm: "audit.read" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/inbox", label: "Inbox", icon: Inbox, perm: "assignment.read" },
      { href: "/people", label: "People", icon: Users, perm: "employee.read" },
      { href: "/projects", label: "Projects", icon: HardHat, perm: "project.read" },
      { href: "/settings", label: "Settings", icon: Settings, perm: "config.manage" },
    ],
  },
];

/* Roles that live in the field. Everyone else gets the desk layout. */
const FIELD_ROLES = new Set(["foreman", "superintendent"]);

export function isFieldRole(role: string | null | undefined): boolean {
  return !!role && FIELD_ROLES.has(role);
}

export function navFor(role: string | null | undefined): NavGroup[] {
  return isFieldRole(role) ? FIELD_NAV : DESK_NAV;
}

export function allItems(role: string | null | undefined): NavItem[] {
  return navFor(role).flatMap((g) => g.items);
}
