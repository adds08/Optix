import type { Permission } from "@stinventory/types";
import { Activity, BarChart3, Boxes, Building2, HardHat, Inbox, LayoutDashboard, LayoutGrid, MessageSquare, Radio, Settings, UserCog, Users, Wrench } from "lucide-react";

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
      /* STI-501: the Desk is in BOTH navs on purpose. SYSTEM_PLAN §6.5 calls it
         "the intended long-term surface for the entire system", and two of its
         four panels — `tools.mine` and `crew.tools` — exist for exactly the
         people this nav serves. It carries no `perm`: the Desk composes itself
         from the registry and shows an explanation when nothing matches, so
         gating the LINK would be a second, cruder copy of that rule. */
      { href: "/desk", label: "Desk", icon: LayoutDashboard, hint: "Everything you can act on" },
      { href: "/my-tools", label: "My Tools", icon: Wrench, hint: "What you are holding" },
      { href: "/chat", label: "Hand Off", icon: MessageSquare, hint: "Type it in one sentence" },
      /* ~~"Overdue and requests"~~ — nothing goes overdue; the borrow model and
         `expected_end_date` were removed on 2026-08-09 (migration 0012). */
      { href: "/inbox", label: "Alerts", icon: Inbox, hint: "Requests and notifications" },
    ],
  },
];

export const DESK_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/desk", label: "Desk", icon: LayoutGrid, hint: "Composed from your permissions" },
      { href: "/home", label: "Dashboard", icon: LayoutDashboard },
    ],
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
      /* STI-303. `people/` is the EMPLOYEE register — domain people who hold
         tools and mostly have no login. This is the ACCOUNT register. Keeping
         them as separate entries is deliberate: conflating "has an account"
         with "holds tools" is how a foreman gets forced into a login he does
         not need. */
      { href: "/admin/users", label: "User Accounts", icon: UserCog, perm: "config.manage" },
      { href: "/settings", label: "Settings", icon: Settings, perm: "config.manage" },
    ],
  },
];

/*
  Roles that live in the field. Everyone else gets the desk layout.

  `mechanic` added by STI-304 — a mechanic holds tools and works out of the
  shop, so the desk's twelve-item navigation is the wrong shelf to put them on.
  This is the LAST role-name branch in the product (STI-307 removed the rest),
  and it is a layout decision rather than an access control: every item in both
  sets is separately permission-filtered in `app-sidebar.tsx`, so a wrong
  answer here shows somebody the wrong menu, never data they may not see.

  It is still wrong by construction — a set of role names has to be edited
  every time a role is added, which is exactly what happened here. Replacing it
  with a permission-driven registry is STI-501, and this line is the argument
  for doing it.

  `engineer` and `office_admin` correctly get the desk layout: an engineer runs
  jobs from a desk and an office administrator never leaves one.
*/
const FIELD_ROLES = new Set(["foreman", "superintendent", "mechanic"]);

export function isFieldRole(role: string | null | undefined): boolean {
  return !!role && FIELD_ROLES.has(role);
}

export function navFor(role: string | null | undefined): NavGroup[] {
  return isFieldRole(role) ? FIELD_NAV : DESK_NAV;
}

export function allItems(role: string | null | undefined): NavItem[] {
  return navFor(role).flatMap((g) => g.items);
}
