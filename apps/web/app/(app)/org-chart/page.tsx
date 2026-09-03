"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Building2, ChevronLeft, ChevronRight, Maximize, Minus, Plus, Search, TriangleAlert, Users, X } from "lucide-react";
import { buildOrgForest, type OrgNode } from "@stinventory/domain/org-chart";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNote, TableSkeleton } from "@/components/sti/page";
import { TreeNode, type NodeState } from "@/components/org-chart/tree";
import type { ChartMember } from "@/components/org-chart/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { EntityPicker } from "@/components/ui/entity-picker";
import { cn } from "@/lib/utils";

/*
  The organisation chart.

  A THIRD SCREEN over `project_team_member` — the same rows the Tools by Jobsite
  hub and the People screen write. Nothing is stored for this page and nothing is
  synchronised into it: change a superintendent on a jobsite card and this chart
  shows it on the next fetch, because it is the same table.

  The reporting edge is `reportsToEmployeeId` on the roster row. There is
  deliberately no rank on a role — see the schema comment; construction firms do
  not share one ladder, and the same person is legitimately a PM on one job and
  the person everyone answers to on another.

  Scoping is the SERVER's job (`projectTeam.orgChart`): a superintendent receives
  only their own chain and crew. This page never filters for access — only for
  what the viewer asked to see.

  No native `<select>` anywhere in this file — `.claude/rules/web.md` bans it
  outright ("the sweep is complete... keep it that way"). The jobsite and role
  filters are `SearchSelect`; the reports-to picker is `EntityPicker`, the same
  component the jobsite team strip already uses for this exact kind of pick.
*/

type Tab = "chart" | "jobsite" | "unassigned";

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/* An element's offset from `ancestor`, walking the offsetParent chain. Unlike
   getBoundingClientRect, offsetLeft/offsetTop are unaffected by a CSS
   `transform` on an ancestor — which is exactly the case here, since the pan/
   zoom viewport is a transform, not a scroll. */
function offsetWithin(el: HTMLElement, ancestor: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

export default function OrgChartPage() {
  const q = trpc.projectTeam.orgChart.useQuery();
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<Tab>("chart");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [role, setRole] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [matchIndex, setMatchIndex] = useState(0);

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  /* `centerOn` reads the CURRENT zoom without depending on it reactively —
     see the comment on `centerOn` for why that distinction is load-bearing. */
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const [pan, setPan] = useState({ x: 40, y: 24 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const members: ChartMember[] = useMemo(() => {
    const rows = q.data?.members ?? [];
    return rows as ChartMember[];
  }, [q.data]);

  const refNames = useMemo(
    () => new Map((q.data?.referenced ?? []).map((r) => [r.id, r.name])),
    [q.data],
  );

  /* Counted over EVERY row, not the filtered set: "also on 2 other jobs" is a
     fact about the person, and it would be a lie if a filter changed it. */
  const instanceCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of members) m.set(r.employeeId, (m.get(r.employeeId) ?? 0) + 1);
    return m;
  }, [members]);

  const projectOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of members) m.set(r.projectId, r.projectName);
    return [...m.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [members]);

  const roleOptions = useMemo(
    () => [...new Set(members.map((r) => r.role))].sort().map((r) => ({ value: r, label: r })),
    [members],
  );

  /* Filters narrow which ROWS build the tree. A filtered-out manager would
     orphan their reports, so the tree is rebuilt from the surviving rows and
     those reports re-root — visible at top level rather than vanishing. */
  const filtered = useMemo(
    () =>
      members.filter(
        (r) => (!project || r.projectId === project) && (!role || r.role === role),
      ),
    [members, project, role],
  );

  const forest = useMemo(() => buildOrgForest(filtered), [filtered]);

  /* Every EMPLOYEE matching the query, in a stable order — the list `N of M`
     and the prev/next buttons cycle over. A name can appear more than once in
     the tree (the multi-job case), so this is deduped by employeeId: cycling
     visits each PERSON once, and jumping still expands whichever occurrence
     the tree actually has under the current filters. */
  const matchList = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of members) {
      if (seen.has(r.employeeId)) continue;
      if (
        r.name.toLowerCase().includes(t) ||
        (r.externalId ?? "").toLowerCase().includes(t) ||
        r.projectName.toLowerCase().includes(t) ||
        r.role.toLowerCase().includes(t)
      ) {
        seen.add(r.employeeId);
        out.push(r.employeeId);
      }
    }
    for (const [id, name] of refNames) {
      if (!seen.has(id) && name.toLowerCase().includes(t)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }, [query, members, refNames]);

  const matches = useMemo(() => (matchList.length ? new Set(matchList) : null), [matchList]);

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (n: OrgNode<ChartMember>) => {
      if (n.children.length) keys.push(n.key);
      n.children.forEach(walk);
    };
    forest.forEach(walk);
    return keys;
  }, [forest]);

  /* Centre a node in the viewport by adjusting `pan`, not by scrolling.
     `scrollIntoView` does not work through a `transform`-based viewport — the
     ancestor never itself scrolls — so this computes the node's untransformed
     offset (via `offsetWithin`, immune to the transform) and solves for the
     pan that puts its centre at the viewport's centre at the CURRENT zoom. */
  const centerOn = useCallback((key: string, z = zoomRef.current) => {
    const el = document.getElementById(`org-node-${key}`);
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!el || !content || !viewport) return;
    const { x, y } = offsetWithin(el, content);
    const cx = x + el.offsetWidth / 2;
    const cy = y + el.offsetHeight / 2;
    setPan({
      x: viewport.clientWidth / 2 - cx * z,
      y: viewport.clientHeight / 2 - cy * z,
    });
    /* `z` defaults to a REF, not the reactive `zoom` state, so this function's
       identity never has to change when zoom changes. It did once, by
       accident: `z = zoom` made `centerOn` depend on `[zoom]`, which cascaded
       through `jumpTo`'s own deps into the effect below and silently
       re-centred the view on the last search hit every time somebody clicked
       a zoom button — fighting exactly the person trying to pan around after
       finding someone. Caught by re-deriving this before it was ever clicked. */
  }, []);

  /* Expand every collapsed ancestor on the path to `employeeId`, across every
     occurrence in the forest (the multi-job case has more than one), then
     centre the first occurrence. Used by search, by the "also on N other
     jobs" chip, and by every "jump to this person" button in the two list
     tabs — one function, so all four ways to ask "where is this person"
     behave the same way. */
  const jumpTo = useCallback((employeeId: string) => {
    const toExpand = new Set<string>();
    let firstKey: string | null = null;
    const walk = (node: OrgNode<ChartMember>, trail: string[]) => {
      const next = [...trail, node.key];
      if (node.employeeId === employeeId) {
        for (const k of trail) toExpand.add(k);
        if (!firstKey) firstKey = node.key;
      }
      node.children.forEach((c) => walk(c, next));
    };
    forest.forEach((r) => walk(r, []));

    /* `flushSync` rather than a `useEffect` watching `[focusKey, collapsed]`.
       The effect version re-ran (and re-centred) on ANY later change to
       `collapsed` — including the viewer manually expanding or collapsing an
       unrelated node — because `focusKey` was still set from the last jump.
       Forcing the expand, the focus mark AND the tab switch to commit
       synchronously means the DOM this function measures next is guaranteed
       to exist, with no effect left to misfire on an unrelated state change. */
    flushSync(() => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const k of toExpand) next.delete(k);
        return next;
      });
      setFocusKey(firstKey);
      setTab("chart");
    });
    if (firstKey) centerOn(firstKey);
  }, [forest, centerOn]);

  /* Typing a search jumps to the first match automatically — this is the gap
     that was reported: dimming everything told the viewer THAT something
     matched, never WHERE. Cycling through the rest is manual (prev/next),
     since auto-advancing while still typing would fight the caret. */
  useEffect(() => {
    setMatchIndex(0);
    if (matchList.length) jumpTo(matchList[0]!);
  }, [matchList, jumpTo]);

  const cycleMatch = (dir: 1 | -1) => {
    if (!matchList.length) return;
    const next = (matchIndex + dir + matchList.length) % matchList.length;
    setMatchIndex(next);
    jumpTo(matchList[next]!);
  };

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  /* Foremen with no reporting line recorded. The tab the user asked for: on a
     jobsite roster a foreman under nobody looks identical to one under a
     superintendent, and this is the only place that difference shows. */
  const unassigned = useMemo(
    () => members.filter((r) => !r.reportsToEmployeeId),
    [members],
  );

  // ---- Pan (drag) and zoom (buttons, wheel) ----

  const zoomBy = (factor: number, aroundClientX?: number, aroundClientY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const mx = aroundClientX != null ? aroundClientX - rect.left : viewport.clientWidth / 2;
    const my = aroundClientY != null ? aroundClientY - rect.top : viewport.clientHeight / 2;
    setZoom((z) => {
      const nz = clampZoom(+(z * factor).toFixed(3));
      setPan((p) => {
        const localX = (mx - p.x) / z;
        const localY = (my - p.y) / z;
        return { x: mx - localX * nz, y: my - localY * nz };
      });
      return nz;
    });
  };

  /*
    NO wheel handling at all — not for pan, not for zoom.

    Two things were tried here and both were reported as wrong. Wheel-zoom
    made scrolling fire dozens of rapid zoom-toward-cursor steps per gesture
    ("going so fast and everywhere the cursor is"); wheel-pan then collided
    with the PAGE'S own scroll the moment the cursor happened to be over the
    chart ("page scroll and when cursor on same content, scrolls the
    content"). Every attempt to referee the two by inspecting the event
    (ctrlKey, passive:false, deltaX/deltaY heuristics) is a variation on the
    same fight over one input device.

    `crew_group_chart.js` in the timesheet product (jQuery orgchart,
    `pan: true`) settles it by not fighting at all: PAN IS DRAG ONLY,
    ZOOM IS BUTTONS ONLY, and the wheel is left alone to do whatever the
    browser page around the chart wants it to do. That is the shape here —
    `onPointerDown`/`onPointerMove` below is the entire pan implementation,
    and `zoomBy` is called only from the +/- buttons.
  */

  const onPointerDown = (e: React.PointerEvent) => {
    /* Don't start a pan when the press lands on a card or a control inside
       one — only the empty canvas drags. Buttons and links inside cards keep
       working exactly as before. */
    if ((e.target as HTMLElement).closest("button, a, input, select")) return;
    /* Without this, a drag that passes over a card's text starts a native
       text selection instead of — or as well as — panning: reported directly,
       the blue selection band across two cards' names. `select-none` on the
       viewport (below) stops the selection from being STYLED; this stops one
       from being STARTED at all, which `select-none` alone does not — a
       mousedown already in flight when the CSS applies can still extend one. */
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
    /* Capture on `currentTarget` — the viewport div the handlers are bound
       to — not `target`, which can be a nested decorative element that never
       receives the subsequent pointermove/up events reliably. */
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) });
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 40, y: 24 });
  };

  const state: NodeState = {
    collapsed,
    onToggle: toggle,
    matches,
    focusKey,
    onPick: jumpTo,
    instanceCount,
  };

  return (
    <div className="space-y-4">
      {/*
        NO PageHeader at all — not even `compact`. The top bar
        (`app-shell.tsx`) already renders the active nav item's label for
        every route but `/home`, so a title here was a second "Org Chart"
        rendered a few pixels under the first one, and `compact` only made
        the duplicate smaller. Reported directly. If this should hold for
        every desk page — several (`/people`, `/projects`, ...) still render
        the full title+description block, which IS the same duplication —
        that is a shared-component change across those pages, not a decision
        to make unilaterally inside this one.
      */}
      {q.isLoading && <TableSkeleton />}
      {q.error && <ErrorNote message={q.error.message} />}

      {q.data && (
        <>
          {q.data.scoped && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              You are seeing your own reporting line — the people above you and everyone
              beneath you. Administrators see the whole organisation.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") cycleMatch(e.shiftKey ? -1 : 1);
                }}
                placeholder="Search a person, job or role…"
                className="w-64 pl-8 pr-16"
              />
              {query && (
                <div className="absolute right-1 top-1 flex items-center gap-0.5">
                  {matchList.length > 0 && (
                    <>
                      <span className="px-1 text-[11px] tabular-nums text-muted-foreground">
                        {matchIndex + 1}/{matchList.length}
                      </span>
                      <Button variant="ghost" size="icon" className="size-6" onClick={() => cycleMatch(-1)}>
                        <ChevronLeft className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-6" onClick={() => cycleMatch(1)}>
                        <ChevronRight className="size-3.5" />
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" size="icon" className="size-6" onClick={() => setQuery("")}>
                    <X className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
            {query && matchList.length === 0 && (
              <span className="text-xs text-muted-foreground">No matches</span>
            )}

            <SearchSelect
              value={project}
              onChange={setProject}
              placeholder="All jobsites"
              options={projectOptions}
              widthClass="w-40"
            />
            <SearchSelect
              value={role}
              onChange={setRole}
              placeholder="All roles"
              options={roleOptions}
              widthClass="w-36"
            />

            <div className="ml-auto flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => setCollapsed(new Set())}>
                Expand all
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCollapsed(new Set(allKeys))}>
                Collapse all
              </Button>
              <Button variant="outline" size="icon" className="size-9" onClick={() => zoomBy(1 / 1.2)} title="Zoom out">
                <Minus className="size-4" />
              </Button>
              <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <Button variant="outline" size="icon" className="size-9" onClick={() => zoomBy(1.2)} title="Zoom in">
                <Plus className="size-4" />
              </Button>
              <Button variant="outline" size="icon" className="size-9" onClick={resetView} title="Reset view">
                <Maximize className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex gap-1 border-b">
            {([
              ["chart", "Chart", Users],
              ["jobsite", "By Jobsite", Building2],
              ["unassigned", `No reporting line (${unassigned.length})`, TriangleAlert],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id as Tab)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
                  tab === id
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>

          {tab === "chart" &&
            (forest.length === 0 ? (
              <EmptyState title="Nobody to show" description="No roster rows match these filters." />
            ) : (
              <div
                ref={viewportRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerLeave={endDrag}
                className={cn(
                  "relative h-[70vh] touch-none select-none overflow-hidden rounded-lg border bg-muted/20",
                  dragging ? "cursor-grabbing" : "cursor-grab",
                )}
              >
                <div
                  ref={contentRef}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "0 0",
                  }}
                  className="relative inline-flex gap-10 p-6 will-change-transform"
                >
                  {forest.map((rootNode) => (
                    <ul key={rootNode.key} className="list-none">
                      <TreeNode node={rootNode} state={state} />
                    </ul>
                  ))}
                </div>
                <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/80 px-2 py-1 text-[11px] text-muted-foreground">
                  Drag to pan · use +/- to zoom
                </p>
              </div>
            ))}

          {tab === "jobsite" && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {projectOptions.map(({ value: id, label: name }) => {
                const rows = filtered.filter((r) => r.projectId === id);
                if (!rows.length) return null;
                return (
                  <JobsiteRosterCard
                    key={id}
                    name={name}
                    rows={rows}
                    members={members}
                    refNames={refNames}
                    onJump={jumpTo}
                    onReportsToChange={(id, reportsToEmployeeId) => {
                      utils.projectTeam.orgChart.setData(undefined, (prev) => {
                        if (!prev) return prev;
                        return { ...prev, members: prev.members.map((m) => (m.id === id ? { ...m, reportsToEmployeeId } : m)) };
                      });
                    }}
                  />
                );
              })}
            </div>
          )}

          {tab === "unassigned" &&
            (unassigned.length === 0 ? (
              <EmptyState
                title="Everybody has a reporting line"
                description="Every current roster row records who that person answers to."
              />
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <p className="border-b bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
                  These people are on a job but nobody is recorded above them. Set it from the
                  By Jobsite tab, or the team strip on the job&apos;s card in Tools by Jobsite.
                </p>
                <ul>
                  {unassigned.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm last:border-0 hover:bg-muted/40"
                    >
                      <button type="button" onClick={() => jumpTo(r.employeeId)} className="min-w-0 flex-1 truncate text-left font-medium hover:underline">
                        {r.name}
                        {r.externalId ? <span className="font-normal text-muted-foreground"> · {r.externalId}</span> : null}
                      </button>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {r.role} · {r.projectName}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </>
      )}
    </div>
  );
}

/*
  One jobsite's roster in the By Jobsite tab, with an inline "reports to"
  picker per row.

  Matches the card list styling job-groups.tsx already established
  (border-b header, `px-4 py-2` rows, `truncate font-medium` name, `text-xs
  text-muted-foreground` secondary) rather than the ad-hoc `text-xs` list this
  replaced — that mismatch is the "font looks out of place" report.
*/
function JobsiteRosterCard({
  name,
  rows,
  members,
  refNames,
  onJump,
  onReportsToChange,
}: {
  name: string;
  rows: ChartMember[];
  members: ChartMember[];
  refNames: Map<string, string>;
  onJump: (employeeId: string) => void;
  onReportsToChange: (rowId: string, reportsToEmployeeId: string | null) => void;
}) {
  const utils = trpc.useUtils();
  const setReportsTo = trpc.projectTeam.setReportsTo.useMutation({
    onSuccess: () => utils.projectTeam.orgChart.invalidate(),
  });

  /* Candidates: everybody else the chart knows about, current members first.
     Referenced-only people (a director with no roster row) can be picked as a
     boss but never as a report — they have no row of their own to update. */
  const candidateOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { value: string; label: string; hint?: string }[] = [];
    for (const m of members) {
      if (seen.has(m.employeeId)) continue;
      seen.add(m.employeeId);
      opts.push({ value: m.employeeId, label: m.name, hint: `${m.role} · ${m.projectName}` });
    }
    for (const [id, refName] of refNames) {
      if (!seen.has(id)) opts.push({ value: id, label: refName, hint: "above every job" });
    }
    return opts;
  }, [members, refNames]);

  const nameOf = (employeeId: string | null) => {
    if (!employeeId) return null;
    return members.find((m) => m.employeeId === employeeId)?.name ?? refNames.get(employeeId) ?? "Unknown";
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <header className="border-b bg-muted/40 px-4 py-2.5">
        <h2 className="truncate text-sm font-semibold">{name}</h2>
      </header>
      <ul>
        {rows
          .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))
          .map((r) => {
            const options = candidateOptions.filter((o) => o.value !== r.employeeId);
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm last:border-0 hover:bg-muted/40">
                <button type="button" onClick={() => onJump(r.employeeId)} className="min-w-0 flex-1 truncate text-left font-medium hover:underline">
                  {r.name}
                </button>
                <span className="shrink-0 text-xs text-muted-foreground">{r.role}</span>
                <EntityPicker
                  options={[{ value: "__none__", label: "— none (top of chart) —" }, ...options]}
                  value={r.reportsToEmployeeId ?? "__none__"}
                  onSelect={(v) => {
                    const next = v === "__none__" ? null : v;
                    onReportsToChange(r.id, next);
                    setReportsTo.mutate({ id: r.id, reportsToEmployeeId: next });
                  }}
                  placeholder="Search a person…"
                  trigger={
                    <button
                      type="button"
                      className="shrink-0 truncate rounded-sm border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                      title="Who this person reports to"
                    >
                      {nameOf(r.reportsToEmployeeId) ?? "— set boss —"}
                    </button>
                  }
                />
              </li>
            );
          })}
      </ul>
    </div>
  );
}
