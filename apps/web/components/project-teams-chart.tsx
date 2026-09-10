"use client";

import { useMemo } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/sti/status";
import { personHint } from "@/lib/format";

/*
  ONE JOB'S REPORTING BRANCH, DRAWN AS A CHART.

  The first version stacked `<div>`s with borders and hoped they lined up: a
  short vertical under each card, a `border-top` across the row of children,
  another stub down into each one. It fell apart exactly where a chart has to
  work — when a row of siblings WRAPPED, the horizontal rule ran the full width
  of the wrapped block while the children sat on two rows, so half of them
  connected to nothing. There was no way to tell whose child was whose.

  So the connectors are now real geometry: the tree is measured first (every
  subtree's width, then every node's x), and the lines are ONE `<svg>` behind
  the cards. A line goes from a parent's bottom edge to a child's top edge
  wherever they actually are, with an arrowhead saying which way authority
  flows. Nothing depends on siblings happening to fit on one row, because the
  layout no longer wraps at all — it scrolls, which is what a real chart does.

  Deliberately NOT the `/org-chart` renderer: that one pans, zooms, collapses
  and counts cross-job instances for the whole tenant. This draws one project's
  branch and nothing else.
*/

export type ChartRow = {
  id: string;
  employeeId: string;
  name: string;
  label: string;
  reportsToEmployeeId: string | null;
  /* A person is name · job title · code, on every surface — a card is not an
     exception. Nullable because HR has never given half the register a title. */
  code?: string | null;
  jobTitle?: string | null;
};

type Node = { row: ChartRow; children: Node[] };
/* A node placed on the canvas: `x` is the CENTRE of its card. */
type Placed = { row: ChartRow; depth: number; x: number; children: Placed[] };

/* Card box and the gaps between. Kept here rather than in classes because the
   SVG has to compute against the same numbers the cards are laid out with —
   two sources for one measurement is how a diagram drifts out of alignment. */
const CARD_W = 208;
const CARD_H = 88;
const GAP_X = 20;
const GAP_Y = 44;

function build(rows: ChartRow[]): Node[] {
  const byEmployee = new Map<string, Node>();
  for (const row of rows) byEmployee.set(row.employeeId, { row, children: [] });
  const roots: Node[] = [];
  for (const node of byEmployee.values()) {
    const parent = node.row.reportsToEmployeeId ? byEmployee.get(node.row.reportsToEmployeeId) : undefined;
    /* A manager who is not on this job leaves their report as a root here —
       the same treatment the list gives it. A visible top-level card beats a
       person silently missing from the chart. */
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (ns: Node[]) => {
    ns.sort((a, b) => a.row.name.localeCompare(b.row.name));
    for (const n of ns) sort(n.children);
  };
  sort(roots);
  return roots;
}

/*
  Place the tree. Classic two-pass: measure each subtree's width, then hand out
  x positions left to right, centring every parent over its children. A leaf is
  one card wide; a parent is the sum of its children plus the gaps between them,
  or one card if that is wider.
*/
function place(roots: Node[]): { placed: Placed[]; width: number; height: number } {
  const widthOf = (n: Node): number => {
    if (!n.children.length) return CARD_W;
    const kids = n.children.reduce((sum, c) => sum + widthOf(c), 0) + GAP_X * (n.children.length - 1);
    return Math.max(CARD_W, kids);
  };
  let maxDepth = 0;
  const walk = (n: Node, left: number, depth: number): Placed => {
    maxDepth = Math.max(maxDepth, depth);
    const w = widthOf(n);
    const out: Placed = { row: n.row, depth, x: left + w / 2, children: [] };
    let cursor = left;
    /* Children are centred as a group under the parent when the parent's own
       card is wider than all of them put together — a lone report should sit
       under its manager, not flush left of a wide card. */
    const kidsW = n.children.length
      ? n.children.reduce((s, c) => s + widthOf(c), 0) + GAP_X * (n.children.length - 1)
      : 0;
    if (kidsW < w) cursor = left + (w - kidsW) / 2;
    for (const c of n.children) {
      out.children.push(walk(c, cursor, depth + 1));
      cursor += widthOf(c) + GAP_X;
    }
    return out;
  };
  let x = 0;
  const placed = roots.map((r) => {
    const p = walk(r, x, 0);
    x += widthOf(r) + GAP_X * 2;
    return p;
  });
  return { placed, width: Math.max(x - GAP_X * 2, CARD_W), height: (maxDepth + 1) * CARD_H + maxDepth * GAP_Y };
}

const flatten = (ns: Placed[]): Placed[] => ns.flatMap((n) => [n, ...flatten(n.children)]);
const yOf = (depth: number) => depth * (CARD_H + GAP_Y);

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

export function ProjectTeamsChart({ rows }: { rows: ChartRow[] }) {
  const { placed, width, height } = useMemo(() => place(build(rows)), [rows]);
  const all = useMemo(() => flatten(placed), [placed]);
  if (!all.length) return null;

  return (
    /* Scrolls sideways rather than wrapping. A wrapped chart cannot say whose
       child is whose, which is the whole defect this replaced. The page body
       never scrolls horizontally — this box does (.claude/rules/web.md). */
    <div className="sti-table-scroll overflow-x-auto p-6">
      <div className="relative mx-auto" style={{ width, height }}>
        <svg
          className="pointer-events-none absolute inset-0"
          width={width}
          height={height}
          aria-hidden
        >
          <defs>
            {/* One arrowhead, reused. `context-stroke` so it inherits the line
                colour instead of needing its own fill kept in step. */}
            <marker
              id="ptc-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {all.flatMap((parent) =>
            parent.children.map((child) => {
              const x1 = parent.x;
              const y1 = yOf(parent.depth) + CARD_H;
              const x2 = child.x;
              const y2 = yOf(child.depth);
              const mid = y1 + GAP_Y / 2;
              /* Down, across, down — an orthogonal elbow rather than a
                 diagonal, so parallel lines stay readable when a manager has
                 six reports. Rounded joins stop the corners reading as cuts. */
              return (
                <path
                  key={child.row.id}
                  d={`M ${x1} ${y1} V ${mid} H ${x2} V ${y2}`}
                  fill="none"
                  className="stroke-primary/40"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  markerEnd="url(#ptc-arrow)"
                />
              );
            }),
          )}
        </svg>

        {all.map((n) => (
          <div
            key={n.row.id}
            className="absolute"
            style={{ left: n.x - CARD_W / 2, top: yOf(n.depth), width: CARD_W, height: CARD_H }}
          >
            <div
              className={
                "flex h-full items-center gap-2.5 rounded-lg border bg-card px-3 shadow-sm transition-colors hover:border-primary/50 " +
                (n.depth === 0 ? "border-primary/40 bg-primary/[0.04]" : "")
              }
            >
              <span
                aria-hidden
                className={
                  "flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold " +
                  (n.children.length
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground")
                }
              >
                {initials(n.row.name)}
              </span>
              <div className="min-w-0">
                <Link
                  href={`/people/${n.row.employeeId}`}
                  className="block truncate text-sm font-medium hover:underline"
                  title={n.row.name}
                >
                  {n.row.name}
                </Link>
                {personHint(n.row) && (
                  <p className="truncate text-[11px] text-muted-foreground" title={personHint(n.row)}>
                    {personHint(n.row)}
                  </p>
                )}
                <div className="mt-1">
                  <StatusPill tone={n.depth === 0 ? "info" : "idle"} label={n.row.label} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
