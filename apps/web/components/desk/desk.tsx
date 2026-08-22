"use client";

import { LayoutGrid } from "lucide-react";
import { usePermissions } from "@/components/use-permissions";
import { EmptyState } from "@/components/sti/page";
import { PANEL_REGISTRY, panelVisible } from "./panel-registry";

/*
  The Desk — SYSTEM_PLAN §6.5's `build_desk(actor)`, in React.

      panels = [p for p in PANEL_REGISTRY if has_permission(actor, p.permission)]

  That is the whole of it. There is no role name in this file, no switch on who
  the user is, and nothing to change when a panel is added — which is the point
  §7 makes: Release 2's question-and-answer Desk assembles views from the same
  registry, so a new panel must not require touching role logic.

  Scope is not passed down as a prop. §6.5's pseudocode threads
  `scope=visible_scope(actor)` into each panel, and that was right for
  pseudocode; in this codebase the scope is resolved SERVER side by the STI-302
  ladder and applied to the query. Handing panels a client-side scope object
  would create a second, weaker copy of the rule — one the server does not
  consult and a user can edit. The panels call procedures; the procedures scope
  themselves.
*/
export function Desk() {
  const { has } = usePermissions();
  const panels = PANEL_REGISTRY.filter((p) => panelVisible(p, has));

  if (!panels.length) {
    /*
      STI-501 AC 5: an actor matching no panel gets an explanation, not a blank
      screen and not a crash. Reachable today — an account whose role has been
      cleared holds no view scope at all, which STI-302 resolves to "sees
      nothing" rather than "sees everything".
    */
    return (
      <EmptyState
        icon={LayoutGrid}
        title="Your desk is empty"
        description="No panel matches the permissions on this account. If that looks wrong, ask the equipment desk to check your role."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {panels.map((p) => {
        const Panel = p.component;
        return <Panel key={p.id} />;
      })}
    </div>
  );
}
