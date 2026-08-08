import type { Permission } from "@stinventory/types";
import {
  Activity,
  BarChart3,
  Boxes,
  Building2,
  HardHat,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Settings,
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
      /* The control hub: one card per job, with crews (foreman + truck/trailer)
         and the tools working it. */
      { href: "/jobsites", label: "Tools by Jobsite", icon: Building2, perm: "asset.read" },
      { href: "/custody", label: "Custody", icon: Wrench, perm: "assignment.read" },
      /* The map is the fleet — trucks and trailers — with the small tools
         aboard them, which is why it is not called just a vehicle map. */
      { href: "/map", label: "Fleet & Small Tools Map", icon: Radio, perm: "location.read" },
    ],
  },
  {
    label: "Insight",
    items: [
      { href: "/reports", label: "Reports & Logs", icon: BarChart3, perm: "report.read" },
      { href: "/activity", label: "Activity", icon: Activity, perm: "asset.read" },
    ],
  },
  {
    label: "Entity",
    items: [
      { href: "/tools", label: "Tool Register", icon: Boxes, perm: "asset.read" },
      { href: "/inbox", label: "Inbox", icon: Inbox, perm: "assignment.read" },
      { href: "/people", label: "People", icon: Users, perm: "employee.read" },
      /* A job and a project are the same thing — the job ID is the cost code. */
      { href: "/projects", label: "Projects / Jobs", icon: HardHat, perm: "project.read" },
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
