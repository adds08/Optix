import type { Permission } from "@stinventory/types";
import {
  Activity,
  BarChart3,
  Boxes,
  Building2,
  HardHat,
  Inbox,
  Layers,
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

export type NavGroup = {
  /* Stable id for the group. The rail selects by this, not by label, so
     renaming a section never resets which one is open. */
  key: string;
  label: string;
  /* The glyph the 48px rail shows for the whole group. Rows keep their own
     icons for the field layout and for menus; the rail only ever shows this. */
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
};

/*
  Two shapes of navigation, not one list with things hidden.

  A foreman is standing in a yard holding a phone. They have exactly three jobs:
  see what they hold, hand something over, and flag a problem. Giving them the
  desk navigation with two thirds greyed out is how field software gets abandoned.

  Desk roles run the operation and need the full surface — including Reports,
  which is the product's moat and had no screen at all before this rebuild.

  System Shell v3 splits these same groups across two columns rather than
  stacking them in one 17rem rail: the 48px rail carries the GROUP (Overview,
  Equipment, Insight, Entity) and the sidebar carries that group's rows. The
  groups and rows below are unchanged — only where they are drawn moved.
*/

export const FIELD_NAV: NavGroup[] = [
  {
    key: "field",
    label: "Field",
    icon: HardHat,
    items: [
      { href: "/my-tools", label: "My Tools", icon: Wrench, hint: "What you are holding" },
      { href: "/chat", label: "Hand Off", icon: MessageSquare, hint: "Type it in one sentence" },
      { href: "/inbox", label: "Alerts", icon: Inbox, hint: "Overdue and requests" },
    ],
  },
];

export const DESK_NAV: NavGroup[] = [
  {
    key: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    items: [{ href: "/home", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    key: "equipment",
    label: "Equipment",
    icon: Wrench,
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
    key: "insight",
    label: "Insight",
    icon: BarChart3,
    items: [
      { href: "/reports", label: "Reports & Logs", icon: BarChart3, perm: "report.read" },
      { href: "/activity", label: "Activity", icon: Activity, perm: "asset.read" },
    ],
  },
  {
    key: "entity",
    label: "Entity",
    icon: Layers,
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

/* A nav row owns its page and everything under it, so a tool's detail page
   keeps Tool Register lit rather than leaving the rail blank. */
export function isCurrent(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/* Which rail group the current URL belongs to. The rail follows the route
   rather than holding its own selection — otherwise a link followed from
   inside a page (a tool card, a search hit) lights a row in a group the rail
   is not showing. */
export function groupForPath(
  role: string | null | undefined,
  pathname: string,
): NavGroup | undefined {
  return navFor(role).find((g) => g.items.some((n) => isCurrent(n.href, pathname)));
}

/*
  How a seat reads at the foot of the sidebar, and what it can actually see.

  Scope is not decoration: project visibility comes from the
  employee_project_assignment / project_team_member rows, so only the yard-wide
  roles genuinely see everything. Saying "all projects" to a foreman would be a
  lie the first time they searched for a job they are not posted to.

  Role and permissions arrive from the session and are administered through
  RBAC. Nothing in the product changes them, and this map must not imply
  otherwise — it names the seat, it does not grant it.
*/
export const SEAT: Record<string, { label: string; scope: string }> = {
  owner: { label: "Owner", scope: "All projects visible" },
  equipment_admin: { label: "Equipment desk", scope: "All projects visible" },
  warehouse: { label: "Warehouse", scope: "Yard and transfers" },
  project_manager: { label: "Project manager", scope: "Assigned projects only" },
  superintendent: { label: "Superintendent", scope: "Assigned projects only" },
  foreman: { label: "Foreman", scope: "Your crew and your tools" },
  read_only: { label: "Read only", scope: "No actions available" },
};

export function seatFor(role: string | null | undefined): { label: string; scope: string } {
  if (role && SEAT[role]) return SEAT[role];
  return { label: role ? role.replace(/_/g, " ") : "Signed in", scope: "Scope set by assignment" };
}
