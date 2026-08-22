"use client";

import type { ComponentType } from "react";
import { VIEW_SCOPES, isViewScope, tierAtLeast, type Permission } from "@stinventory/types";
import { ToolsByJobsitePanel, MyToolsPanel, CrewToolsPanel, DeskQueuePanel } from "./panels";

/*
  The Desk panel registry — SYSTEM_PLAN §6.5 (STI-501).

  §6.5's pseudocode:

      for panel in PANEL_REGISTRY:
          if has_permission(actor, panel.permission):
              panels.append(panel.render(scope=visible_scope(actor)))

  and §7's reason for it: Release 2's question-and-answer Desk assembles views
  from this registry, so *"Release 2 adds panels without touching role logic"*.
  Adding a panel is one entry in the array below and nothing else — no role
  logic, no change to the page that renders it.

  What this replaced: `WIDGET_DEFS` + `widgetVisibility(prefs)` composed the
  dashboard from the user's THEME PREFERENCES, with no permission field at all,
  while role handling lived in two literal arrays selected off a hardcoded set
  of role names in `nav-config.ts`. Preferences and permissions were the same
  mechanism, which meant a user could hide a panel and — had a panel ever been
  permission-bearing — reveal one.

  **Preferences decide LAYOUT. Permissions decide EXISTENCE.** They stay
  separate deliberately (STI-501 AC 6): `widgetVisibility` still governs the
  Command Center widgets, and it cannot reach anything in this file.

  Nothing here is a security boundary. Every panel's data comes from a tRPC
  procedure that carries its own `requirePermission` and its own scoping
  through the STI-302 ladder — applied to the query, never as a post-filter.
  This registry decides what to RENDER; the server decides what to RETURN.
*/

export type DeskPanel = {
  id: string;
  label: string;
  /* The permission §6.5 names for this panel. */
  permission: Permission;
  /*
    How `permission` is tested. §6.5 gives every panel one permission, which is
    too coarse for the four ladder scopes, because the ladder is ORDERED and
    "at least this wide" and "exactly this" are different questions:

      - "at least"  — Tools by Jobsite is gated on `assets.view.project`, but
                      the yard desk holds `assets.view.all` and obviously needs
                      the jobsite view. Testing `has('assets.view.project')`
                      literally would hide the desk's main screen from the desk.
      - "exactly"   — Crew Tools is gated on `assets.view.crew`, and only a
                      superintendent HAS a crew. Under "at least", the desk
                      would get a panel that renders nothing, every time.

    Two words of config instead of two mechanisms. Non-ladder permissions
    ignore this and use a plain `has()`.
  */
  match?: "atLeast" | "exactly";
  component: ComponentType;
};

/**
 * Does this actor see this panel?
 *
 * `has` comes from `usePermissions()`. Kept as a pure function of (panel, has)
 * so it is testable without React and so the rule lives in exactly one place.
 */
export function panelVisible(panel: DeskPanel, has: (p: Permission) => boolean): boolean {
  if (!isViewScope(panel.permission)) return has(panel.permission);

  const actorTier = VIEW_SCOPES.find((s) => has(s));
  /* No tier at all resolves to "sees nothing", never "sees everything" — the
     same secure default scope.ts enforces server side (STI-302). */
  if (!actorTier) return false;

  return panel.match === "exactly"
    ? actorTier === panel.permission
    : tierAtLeast(actorTier, panel.permission);
}

/*
  The Release 1 panel set — SYSTEM_PLAN §6.5, four of the five it names.

  **`tools.overdue` is deliberately absent, and this is the finding rather than
  an omission.** §6.5 asks for `Panel('tools.overdue', 'assets.view.all',
  OverdueTools)`, but nothing in this system can go overdue: the borrow model
  was removed on 2026-08-09, `assignment.expected_end_date` was DROPPED in
  migration `0012`, `isOverdueLoan` was deleted from `packages/domain`, and no
  `dashboard.overdueLoans` procedure exists. Building the panel would mean
  inventing a due date, which is precisely the failure CLAUDE.md records: a
  stale document caused a ticket specifying a control for a state the backend
  had deleted months earlier. STI-502 AC 5 says to REPORT the disagreement
  rather than copy it into a third place. Reported — in the ticket, in
  SYSTEM_PLAN §6.5, and here.
*/
export const PANEL_REGISTRY: DeskPanel[] = [
  { id: "tools.mine", label: "My Tools", permission: "assets.view.own", match: "atLeast", component: MyToolsPanel },
  { id: "crew.tools", label: "Crew Tools", permission: "assets.view.crew", match: "exactly", component: CrewToolsPanel },
  { id: "tools.by_jobsite", label: "Tools by Jobsite", permission: "assets.view.project", match: "atLeast", component: ToolsByJobsitePanel },
  { id: "desk.queue", label: "Awaiting the desk", permission: "assignment.approve", component: DeskQueuePanel },
];
