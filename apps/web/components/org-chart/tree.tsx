"use client";

import { ChevronDown, ChevronRight, HardHat, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrgNode } from "@stinventory/domain/org-chart";
import type { ChartMember } from "./types";

/*
  The chart itself — a top-down tree of cards, drawn with CSS rather than SVG.

  No rendering library. `buildOrgForest` in packages/domain already produces the
  nested shape, and what remained was boxes and connector lines, which flexbox
  and two pseudo-elements do natively. A layout library (d3-hierarchy, dagre)
  earns its place when you need COORDINATES — for SVG, or for edges that cross.
  A tree of DOM cards needs neither, and DOM buys three things an SVG chart has
  to reimplement: the browser's own text wrapping, `scrollIntoView` for the
  search jump, and real focusable elements for keyboard and screen readers.

  Deliberately NOT draggable. Moving a card would have to mean rewriting
  `reports_to`, and a reporting line is not something to change by nudging a box
  a few pixels — it goes through the picker on the jobsite card, where the write
  is explicit and permission-checked.
*/

export type NodeState = {
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  /* Employee ids matching the current search. Matches are ringed, and
     everything else dims, so a hit is findable in a wide tree. */
  matches: Set<string> | null;
  focusKey: string | null;
  onPick: (employeeId: string) => void;
  /* How many CURRENT rows each employee holds, for the "also on N other jobs"
     chip. Counted across the whole chart, not the filtered view. */
  instanceCount: Map<string, number>;
};

const ROLE_LABEL: Record<string, string> = {
  pm: "Project Manager",
  superintendent: "Superintendent",
  foreman: "Foreman",
};

const roleLabel = (r: string) =>
  ROLE_LABEL[r] ?? r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function Card({ node, state }: { node: OrgNode<ChartMember>; state: NodeState }) {
  const m = node.member;
  const employeeId = node.employeeId;
  const dimmed = state.matches ? !state.matches.has(employeeId) : false;
  const hit = state.matches?.has(employeeId) ?? false;
  const others = (state.instanceCount.get(employeeId) ?? 1) - 1;

  return (
    <div
      id={`org-node-${node.key}`}
      className={cn(
        "relative w-56 shrink-0 rounded-lg border bg-card p-3 text-left shadow-sm transition",
        dimmed && "opacity-35",
        hit && "ring-2 ring-primary border-primary",
        state.focusKey === node.key && "ring-2 ring-ring",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded bg-muted p-1 text-muted-foreground">
          {m?.role === "foreman" ? <HardHat className="size-3.5" /> : <Users className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => state.onPick(employeeId)}
            className="block truncate text-sm font-medium hover:underline"
            title={m?.name ?? node.employeeId}
          >
            {m?.name ?? "Unknown"}
          </button>
          <p className="truncate text-xs text-muted-foreground">
            {m ? roleLabel(m.role) : "Not on a job"}
            {m?.externalId ? ` · ${m.externalId}` : ""}
          </p>
        </div>
      </div>

      {m ? (
        <p className="mt-2 truncate text-[11px] text-muted-foreground" title={m.projectName}>
          {m.projectName}
        </p>
      ) : (
        /* A synthetic node: somebody every job points at who holds no roster
           row of their own. Saying so is better than an empty line, which reads
           as missing data. */
        <p className="mt-2 text-[11px] italic text-muted-foreground">Above every job below</p>
      )}

      {others > 0 && (
        <button
          type="button"
          onClick={() => state.onPick(employeeId)}
          className="mt-2 inline-flex rounded-sm bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground hover:bg-accent/80"
        >
          also on {others} other {others === 1 ? "job" : "jobs"}
        </button>
      )}

      {node.children.length > 0 && (
        <button
          type="button"
          onClick={() => state.onToggle(node.key)}
          className="mt-2 flex w-full items-center gap-1 rounded border-t pt-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {state.collapsed.has(node.key) ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
          {node.children.length} direct {node.children.length === 1 ? "report" : "reports"}
        </button>
      )}
    </div>
  );
}

export function TreeNode({ node, state }: { node: OrgNode<ChartMember>; state: NodeState }) {
  const collapsed = state.collapsed.has(node.key);
  const kids = collapsed ? [] : node.children;

  return (
    <li className="relative flex flex-col items-center">
      <Card node={node} state={state} />
      {kids.length > 0 && (
        <>
          {/* stem down from this card into the row of children */}
          <span aria-hidden className="h-6 w-px bg-border" />
          <ul className="relative flex gap-4">
            {/* the horizontal rail joining the children, clipped to the first
                and last child so it does not overhang the row */}
            {kids.length > 1 && (
              <span
                aria-hidden
                className="absolute left-0 right-0 top-0 mx-auto h-px bg-border"
                style={{ left: "calc(7rem)", right: "calc(7rem)" }}
              />
            )}
            {kids.map((c) => (
              <li key={c.key} className="flex list-none flex-col items-center pt-0">
                <span aria-hidden className="h-6 w-px bg-border" />
                <ul className="list-none">
                  <TreeNode node={c} state={state} />
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}
