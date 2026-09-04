import type { Permission } from "@stinventory/types";
import { Activity, BarChart3, Boxes, Building2, Cpu, HardHat, Inbox, LayoutDashboard, LayoutGrid, MessageSquare, Network, Palette, Radio, Settings, ShieldCheck, SlidersHorizontal, Truck, Users, Wrench } from "lucide-react";

export type NavItem = {
  /*
    Stable identity, never derived from the route.

    A pin stores THIS, not the href — see `nav-pins.ts`. Renaming a route or
    moving Custody under a different prefix has to leave everybody's pins
    where they were; keying on the route means a rename silently empties a
    sidebar section nobody edited, and nothing fails loudly enough for anyone
    to connect the two. Change a label, change a route, change a permission —
    never change an `id`.
  */
  id: string;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm?: Permission;
  /* One-line description, shown in the "Search all features" launcher card.
     Written here, not at the call site, so the launcher and any future copy
     of it read the same words. */
  desc?: string;
  /* Shown in the field layout as a large primary action rather than a nav row. */
  hint?: string;
  /* Wall surfaces: the page owns the whole content region — the shell drops its
     max-width, its padding and its scroll box for these. Declared beside the
     route rather than sniffed from the pathname in app-shell.tsx, so adding a
     second wall screen is one field and not another branch in the shell. */
  fullBleed?: boolean;
  /* Set only at runtime by `applyFeatureStates` below — never in the static
     arrays in this file. `undefined`/`"enabled"` render exactly as before;
     `"beta"`/`"upcoming"` get a badge, and `"upcoming"` additionally loses
     its link (see `app-sidebar.tsx`'s `NavRow`). A `"hidden"` item never
     reaches a row at all — it is filtered out before rendering. */
  featureState?: "beta" | "upcoming";
};

export type NavGroup = {
  label: string;
  items: NavItem[];
  /* The launcher's glyph for this group. Declared here rather than borrowed from
     `items[0]`, which is what it used to do: reordering a group's rows then
     silently changed the icon somebody had learned to aim at. */
  icon: React.ComponentType<{ className?: string }>;
};

/*
  Two shapes of navigation, not one list with things hidden.

  A foreman is standing in a yard holding a phone. They have exactly three jobs:
  see what they hold, hand something over, and flag a problem. Giving them the
  desk navigation with two thirds greyed out is how field software gets abandoned.

  Desk roles run the operation and need the full surface — including Reports,
  which is the product's moat and had no screen at all before this rebuild.
*/

/*
  Settings is the same group in both layouts, and it is NOT gated as a whole.

  The page it replaced mixed two unrelated things: tenant configuration behind
  `config.manage`, and the viewer's own appearance, which needs no permission
  at all. Gating the group would put a foreman's font size behind an
  administrator permission — a regression that has already been fixed once, in
  the old page's `personal` escape hatch. Per-row `perm` plus the shell's
  drop-empty-groups rule reproduces that outcome structurally: an administrator
  sees five rows here, a foreman sees Appearance, and nobody sees an empty pane.
*/
const SETTINGS_GROUP: NavGroup = {
  label: "Settings",
  icon: Settings,
  items: [
    { id: "settings-general", href: "/settings", label: "General", icon: SlidersHorizontal, perm: "config.manage", desc: "Branding, approvals and mail" },
    { id: "settings-modules", href: "/settings/modules", label: "Modules", icon: LayoutGrid, perm: "config.manage", desc: "Which parts this organisation uses" },
    { id: "settings-ai", href: "/settings/ai", label: "AI & API", icon: Cpu, perm: "config.manage", desc: "The chat parser's model and key" },
    /* No `perm`: a per-user preference written through `preferences.set`, which
       writes the caller's own row. */
    { id: "settings-appearance", href: "/settings/appearance", label: "Appearance", icon: Palette, desc: "Your own theme, type and density" },
    /* ~~User Accounts~~ — removed 2026-08-28 with `/admin/users`.

       STI-303 split it from `/people` on the reasoning that "has an account"
       and "holds tools" are different facts, and conflating them forces a
       foreman into a login he does not need. The fact was right; the second
       screen was the wrong answer to it. Two registers of the same people meant
       two searches and two places a name could be wrong.

       The distinction is now kept by `role.needsLogin` — a role states whether
       its people sign in at all — and `/people` shows each person's account
       state in its own column. Inviting, resetting, deactivating and resending
       all live on the person's row menu. Don't add this back. */
    { id: "roles-permissions", href: "/admin/roles", label: "Roles & Permissions", icon: ShieldCheck, perm: "config.manage", desc: "What each account may do" },
    /* Distinct from "Roles & Permissions" above: that gates what an ACCOUNT
       may do, this defines the tiers a PERSON can hold on a project team —
       pm/superintendent/foreman today, whatever an organization adds
       tomorrow. Gated on project.team.manage, not config.manage, because
       adding a tier here needs neither platform config access nor a login
       role edit. */
    { id: "team-roles", href: "/settings/team-roles", label: "Team Roles", icon: HardHat, perm: "project.team.manage", desc: "The tiers a person can hold on a job" },
  ],
};

export const FIELD_NAV: NavGroup[] = [
  {
    label: "Field",
    icon: Wrench,
    items: [
      { id: "my-tools", href: "/my-tools", label: "My Tools", icon: Wrench, hint: "What you are holding", desc: "The tools in your own hands" },
      { id: "handoff", href: "/chat", label: "Hand Off", icon: MessageSquare, hint: "Type it in one sentence", desc: "Tell the desk what you are handing over" },
      /* ~~"Overdue and requests"~~ — nothing goes overdue; the borrow model and
         `expected_end_date` were removed on 2026-08-09 (migration 0012).

         Kept here while it was removed from the desk nav: a foreman's entire
         job on this layout is the alerts list, and a phone's bell icon is a
         worse place to bury it than a nav row. Say so if you want it gone from
         here too — it is a deliberate divergence, not an oversight. */
      { id: "alerts", href: "/inbox", label: "Alerts", icon: Inbox, hint: "Requests and notifications", desc: "Requests, replies and reminders" },
    ],
  },
  SETTINGS_GROUP,
];

/*
  The desk groups are MODULES, one surface of the business each
  (design/STInventory App.dc.html). "Equipment" is the whole equipment side —
  where it is and who holds it, plus the two registers — not two modules, so
  the sidebar never shows a job hub with its register missing.
*/
export const DESK_NAV: NavGroup[] = [
  {
    label: "Home",
    icon: LayoutDashboard,
    items: [
      /* The project monitor — a wall surface, cycling one job at a time. It
         replaced the widget dashboard and the Desk command surface on
         2026-08-23; both were removed on 2026-09-03 once the monitor had been
         lived with. */
      { id: "dashboard", href: "/home", label: "Dashboard", icon: LayoutDashboard, fullBleed: true, desc: "The jobsite board, cycling one job at a time" },
    ],
  },
  {
    label: "Equipment",
    icon: Boxes,
    items: [
      /* The control hub: one card per job, with crews (foreman + truck/trailer)
         and the tools working it. */
      { id: "tools-by-jobsite", href: "/jobsites", label: "Tools by Jobsite", icon: Building2, perm: "asset.read", desc: "Every tool, grouped by job and crew" },
      { id: "custody", href: "/custody", label: "Custody", icon: Wrench, perm: "assignment.read", desc: "Who is holding what, right now" },
      /* The map is the fleet — trucks and trailers — with the small tools
         aboard them, which is why it is not called just a vehicle map. */
      { id: "fleet-map", href: "/map", label: "Fleet & Small Tools Map", icon: Radio, perm: "location.read", desc: "Where the fleet is sitting right now" },
      /*
        The small-tools register. `id` is deliberately still `tool-register`:
        labels are free to change and ids are not — renaming a row must not
        empty anybody's pins.
      */
      { id: "tool-register", href: "/tools", label: "Small Tools", icon: Wrench, perm: "asset.read", desc: "The master asset list and serials" },
      /* Trucks and trailers today, heavy plant the moment a row exists for it.
         `vehicle.read` gates it, same as the fleet map. */
      { id: "equipment-register", href: "/equipment", label: "Equipment", icon: Truck, perm: "vehicle.read", desc: "Trucks, trailers and heavy plant" },
    ],
  },
  {
    label: "People",
    icon: Users,
    items: [
      { id: "people", href: "/people", label: "People", icon: Users, perm: "employee.read", desc: "Your crew and the roles they hold" },
      /* A job and a project are the same thing — the job ID is the cost code. */
      { id: "projects", href: "/projects", label: "Projects", icon: HardHat, perm: "project.read", desc: "Every job and job group on record" },
      /* The reporting structure, read from the same project_team_member rows
         the Tools by Jobsite team strip writes — not a second store. Gated on
         `project.team.read` like the roster it draws; the procedure narrows a
         non-admin to their own chain, so the LINK does not need a second gate. */
      { id: "org-chart", href: "/org-chart", label: "Org Chart", icon: Network, perm: "project.team.read", desc: "Who answers to whom, on each job" },
    ],
  },
  {
    label: "Reports",
    icon: BarChart3,
    items: [
      { id: "reports", href: "/reports", label: "Reports & Logs", icon: BarChart3, perm: "report.read", desc: "Every register and report in one place" },
      { id: "activity", href: "/activity", label: "Activity", icon: Activity, perm: "asset.read", desc: "The live tool-movement feed" },
    ],
  },
  SETTINGS_GROUP,
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

const SETTINGS_ITEM_IDS = new Set(SETTINGS_GROUP.items.map((n) => n.id));

/* Whether an id belongs to the Settings group — the same exemption
   `applyFeatureStates` uses, exposed for the shell's redirect effect, which
   has to make the identical call before it sends anyone away from a route a
   stray feature row named. */
export function isSettingsItemId(id: string): boolean {
  return SETTINGS_ITEM_IDS.has(id);
}

export function navFor(role: string | null | undefined): NavGroup[] {
  return isFieldRole(role) ? FIELD_NAV : DESK_NAV;
}

export function allItems(role: string | null | undefined): NavItem[] {
  return navFor(role).flatMap((g) => g.items);
}

/*
  Stable key for a nav group, shared by the rail (which draws one glyph per
  group) and the sidebar (which shows the active group's rows). Derived from
  the label because `NavGroup` carries no key of its own.
*/
export function groupKey(g: NavGroup): string {
  return g.label.toLowerCase().replace(/[^a-z]+/g, "-");
}

/*
  The nav row a pathname is on, preferring the LONGEST matching href.

  Every consumer used to do `pathname === href || pathname.startsWith(href + "/")`
  against the list in declaration order and take the first hit. That was correct
  only while no nav href was a prefix of another one — which stopped being true
  the moment Settings gained sub-pages: on `/settings/ai`, `/settings` matches
  first, so the General row lit up, the AI row did not, and the rail resolved to
  the wrong group. Sorting by specificity is the whole fix, and it belongs here
  rather than in each of the three callers.
*/
export function matchItem(items: NavItem[], pathname: string): NavItem | undefined {
  return items
    .filter((n) => pathname === n.href || pathname.startsWith(n.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/*
  Generalises ADR-11 (docs/06-decisions.md) from a binary disabled-modules
  list into four states — enabled/beta/upcoming/hidden — read from
  `feature.states` (packages/api-contracts/src/routers/feature.ts) and keyed
  on the same stable `id` a pin already trusts.

  Applied in `app-shell.tsx` in the same pass as the permission filter, which
  is the property ADR-11 asks for: the rail and the sidebar read one already-
  filtered array, so a glyph and the pane it opens can never disagree about
  what a group contains.

  Settings is hard-exempted, group by group rather than by an id list — an
  administrator who could hide Settings could hide the only way back. This is
  presentation only, same as the permission filter beside it: nothing here
  touches what a server procedure allows, and a hidden or upcoming key never
  reaches this function's callers without a permission check of its own
  already having run first.
*/
export function applyFeatureStates(groups: NavGroup[], states: Record<string, string>): NavGroup[] {
  return groups
    .map((g) => {
      if (g.label === "Settings") return g;
      return {
        ...g,
        items: g.items
          .filter((n) => states[n.id] !== "hidden")
          .map((n): NavItem => {
            const s = states[n.id];
            if (s === "beta") return { ...n, featureState: "beta" };
            if (s === "upcoming") return { ...n, featureState: "upcoming" };
            return n;
          }),
      };
    })
    .filter((g) => g.items.length > 0);
}
