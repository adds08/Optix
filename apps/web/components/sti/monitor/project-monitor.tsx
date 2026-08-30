"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play } from "lucide-react";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { useJobScope } from "@/components/job-scope";
import { useMonitorPrefs } from "@/lib/monitor-prefs";
import { usePermissions } from "@/components/use-permissions";
import { StatusPill, Tag } from "@/components/sti/status";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  The project monitor — the wall surface.

  A third surface class beside the desk and the field phone: a screen nobody
  touches. It cycles the jobs in scope one at a time, scrolling that job's tools
  past a foreman standing across the room from it. Every control on it is
  optional; the board is correct if nobody ever clicks anything.

  Five fixed bands, no page scroll. The ONLY thing that moves is the table body:

    status bar     which board this is, the portfolio totals, the clock
    subject header the job on screen right now, and its own totals
    table          the payload
    aggregate bar  tools-per-custodian chips
    transport bar  previous job, progress + dots + countdown, next job

  Two clocks, both from the design's spec:

    dwell   12s + 1.1s per row, capped at 52s. A fixed dwell either rushes a
            long list or strands a short one; a four-tool job holds ~16s and an
            eighteen-tool job holds the full 52s.
    travel  the table holds at the top for the first 18% of the dwell, scrolls
            through the middle, and settles by 88%. Rows are never still moving
            when the job changes.

  Travel is driven imperatively from a ref on every frame, not by a CSS
  animation, because it has to stay locked to the dwell clock and reset cleanly
  when somebody presses next. For the same reason the countdown is the only
  per-second React state — the scroll position, the progress bar and the scroll
  rail are all written straight to the DOM, so a board left running for a week
  is not re-rendering a table sixty times a second.

  Where this departs from the design, and why:

    - No due dates and no OVERDUE mark. Nothing falls due: the borrow model and
      `assignment.expected_end_date` were removed on 2026-08-09 (migration 0012).
      The design's sample data predates that.
    - No money band. Value figures left the dashboard on the same date; a
      screen visible from a corridor is the last place to put acquisition cost.
    - "Crew" chips are keyed on the CUSTODIAN, not on a foreman role. Custody
      follows the person in this system, so whoever holds the tool is the name
      that belongs on the chip.
    - The board honours the shell's job scope selector like every other screen,
      so a superintendent scoped to one group sees that group cycling and not
      the whole company.
    - The type scale is the DESK's, not the design's wall floor. The readme sets
      a 12px floor with values at 14-26px for a screen read from across a room;
      in practice this board is also open on laptops beside every other screen
      in the product, and a table running 16px rows next to one running 14px
      reads as two different applications. Rows sit at 14px and values at 15-20,
      matching MetricCell and the register. Turn the TV's own scale up instead —
      the whole app is rem-based and Settings scales it.
*/

/* Fixed row height. The travel maths needs one number it can trust rather than
   a measurement that changes when a tool name wraps. */
const ROW_H = 38;
/*
  Dwell, and therefore crawl speed.

  The design specifies 12s + 1.1s per row capped at 52s. That is tuned for the
  design's own sample lists and reads as a hurry on a real register: a 40-tool
  job pinned at the 52s cap has to travel roughly 1000px in the 70% of the dwell
  that scrolls, which is fast enough that you lose your place looking away. The
  numbers below are the same shape with room to breathe — the point of a board
  nobody touches is that taking longer costs nothing.

  Whatever is left is a matter of the room and the screen size, so the device
  scales all of it with one multiplier (lib/monitor-prefs.ts).
*/
const DWELL_BASE = 16_000;
const DWELL_PER_ROW = 2_000;
const DWELL_MAX = 100_000;
const TRAVEL_START = 0.18;
const TRAVEL_END = 0.88;

type MonitorTool = {
  id: string;
  tag: string | null;
  name: string;
  serial: string | null;
  custodian: string;
  status: string | null;
  condition: string | null;
};

type MonitorProject = {
  id: string;
  code: string | null;
  name: string;
  site: string | null;
  status: string | null;
  tools: MonitorTool[];
  crews: { name: string; count: number }[];
  noSerial: number;
  unassigned: number;
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const dwellFor = (rows: number, pace = 1) =>
  Math.min(DWELL_BASE + DWELL_PER_ROW * rows, DWELL_MAX) * pace;

export function ProjectMonitor() {
  const { has } = usePermissions();
  const { projectIds } = useJobScope();
  const { pace } = useMonitorPrefs();
  const seesTools = has("asset.read");

  const projectsQ = trpc.project.list.useQuery(undefined, { enabled: seesTools });
  /* One list, refetched on a slow beat. A wall display is not a live feed — it
     is a board somebody glances at, and a minute-old count is not a wrong one. */
  const assetsQ = trpc.asset.list.useQuery(undefined, { enabled: seesTools, refetchInterval: 60_000 });

  const boards = useMemo<MonitorProject[]>(() => {
    const assets = assetsQ.data ?? [];
    const out: MonitorProject[] = [];

    for (const p of projectsQ.data ?? []) {
      if (projectIds && !projectIds.has(p.id)) continue;
      const rows = assets.filter((a) => a.currentProjectId === p.id);
      if (!rows.length && p.status !== "active") continue;

      const byCustodian = new Map<string, number>();
      let unassigned = 0;
      for (const a of rows) {
        if (!a.custodianName) {
          unassigned += 1;
          continue;
        }
        byCustodian.set(a.custodianName, (byCustodian.get(a.custodianName) ?? 0) + 1);
      }

      out.push({
        id: p.id,
        code: p.externalId,
        name: p.name,
        site: p.siteAddress,
        status: p.status,
        tools: rows.map((a) => ({
          id: a.id,
          tag: a.tag,
          name: formatAssetModel(a),
          serial: a.serialNumber,
          custodian: a.custodianName ?? "—",
          status: a.status,
          condition: a.condition,
        })),
        crews: [...byCustodian.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
        noSerial: rows.filter((a) => a.isSerialized && !a.serialNumber).length,
        unassigned,
      });
    }
    /* Busiest job first: the board opens on the one worth looking at. */
    return out.sort((a, b) => b.tools.length - a.tools.length || a.name.localeCompare(b.name));
  }, [projectsQ.data, assetsQ.data, projectIds]);

  /* Portfolio totals — the whole tenant's shape, not the job on screen. Shown
     on the status bar so the board still says something during a job with no
     tools on it. */
  const portfolio = useMemo(() => {
    const assets = assetsQ.data ?? [];
    return {
      yard: assets.filter((a) => !a.currentProjectId && a.status === "available").length,
      onJobs: assets.filter((a) => a.currentProjectId).length,
      shop: assets.filter((a) => a.status === "in_maintenance").length,
      lost: assets.filter((a) => a.status === "lost").length,
    };
  }, [assetsQ.data]);

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [full, setFull] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  /* The animation loop reads these instead of closing over state, so pausing or
     jumping a job does not tear down and rebuild the frame callback. */
  const elapsed = useRef(0);
  const pausedRef = useRef(paused);
  const countRef = useRef(boards.length);
  const dwellRef = useRef(DWELL_BASE);

  const count = boards.length;
  const safeIndex = count ? Math.min(index, count - 1) : 0;
  const board = boards[safeIndex];
  const dwell = dwellFor(board?.tools.length ?? 0, pace);

  pausedRef.current = paused;
  countRef.current = count;
  dwellRef.current = dwell;

  /* Any deliberate move restarts both clocks — a countdown that carries over
     from the job you just left is a countdown that lies. Pause is the one
     exception the design calls out: it resumes from where it stopped. */
  const goto = useCallback((next: number) => {
    elapsed.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setIndex(next);
  }, []);

  const step = useCallback(
    (delta: number) => {
      const n = countRef.current;
      if (!n) return;
      goto((safeIndex + delta + n) % n);
    },
    [goto, safeIndex],
  );

  useEffect(() => {
    if (!count) return;
    let raf = 0;
    let last = performance.now();
    let shownSecond = -1;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = now - last;
      last = now;
      if (!pausedRef.current) elapsed.current += dt;

      const d = dwellRef.current;
      const p = clamp(elapsed.current / d, 0, 1);

      /* Travel: hold, scroll, settle. */
      const el = scrollRef.current;
      if (el) {
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        const t = clamp((p - TRAVEL_START) / (TRAVEL_END - TRAVEL_START), 0, 1);
        el.scrollTop = max * t;
        if (thumbRef.current) {
          const frac = el.scrollHeight > 0 ? el.clientHeight / el.scrollHeight : 1;
          thumbRef.current.style.height = `${clamp(frac, 0.08, 1) * 100}%`;
          thumbRef.current.style.top = `${t * (1 - clamp(frac, 0.08, 1)) * 100}%`;
        }
      }

      if (progressRef.current) progressRef.current.style.width = `${p * 100}%`;

      const secs = Math.max(0, Math.ceil((d - elapsed.current) / 1000));
      if (secs !== shownSecond) {
        shownSecond = secs;
        setRemaining(secs);
      }

      if (elapsed.current >= d && !pausedRef.current) {
        elapsed.current = 0;
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
        setIndex((i) => (countRef.current ? (i + 1) % countRef.current : 0));
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  }, []);

  if (!seesTools) {
    return (
      <Band>
        <p className="text-sm text-muted-foreground">
          This board shows tools on jobs. Your account cannot read the tool register, so there is
          nothing here for it to cycle.
        </p>
      </Band>
    );
  }

  if (projectsQ.isLoading || assetsQ.isLoading) {
    return (
      <Band>
        <p className="label-xs text-sm tracking-[0.14em]">Loading the board…</p>
      </Band>
    );
  }

  if (projectsQ.isError || assetsQ.isError) {
    return (
      <Band>
        <p className="text-sm text-crit">
          The board could not load. {(projectsQ.error ?? assetsQ.error)?.message}
        </p>
      </Band>
    );
  }

  if (!board) {
    return (
      <Band>
        <p className="text-sm text-muted-foreground">
          No jobs in scope. Widen the job selector, or add a project.
        </p>
      </Band>
    );
  }

  /* `?? board` is not defensive padding: with a single job in scope the board
     IS its own previous and next, and that is the honest label for the corners
     rather than blanking them. It also gives TypeScript the proof it wants that
     a modulo index lands on a row. */
  const prev = boards[(safeIndex - 1 + count) % count] ?? board;
  const next = boards[(safeIndex + 1) % count] ?? board;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-background">
      {/* ───── band 1: status ───── */}
      <div className="flex h-[60px] shrink-0 items-center gap-6 border-b bg-card px-6">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={cn("size-2 rounded-full", paused ? "bg-warn" : "animate-pulse bg-ok")}
          />
          <span className="font-mono text-sm uppercase tracking-[0.14em] text-foreground">
            {num(count)} {count === 1 ? "project" : "projects"} · {paused ? "paused" : "live"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-6">
          <Stat label="In the yard" value={portfolio.yard} />
          <Stat label="On jobs" value={portfolio.onJobs} />
          <Stat label="In the shop" value={portfolio.shop} />
          <Stat label="Unaccounted" value={portfolio.lost} tone={portfolio.lost ? "crit" : undefined} />
          <Clock />
          <div className="flex items-center gap-1">
            <Control label={paused ? "Resume" : "Pause"} onClick={() => setPaused((v) => !v)}>
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            </Control>
            <Control label={full ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFull}>
              {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Control>
          </div>
        </div>
      </div>

      {/* ───── band 2: subject ───── */}
      <div className="flex shrink-0 items-start gap-6 border-b px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xl font-bold leading-none tracking-tight text-foreground">
              {board.code ?? "NO CODE"}
            </span>
            <StatusPill status={board.status} />
          </div>
          <p className="mt-1.5 truncate text-base font-semibold text-foreground">{board.name}</p>
          {board.site ? (
            <p className="truncate text-sm text-muted-foreground">{board.site}</p>
          ) : null}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-6">
          <Stat label="Tools" value={board.tools.length} big />
          <Stat label="Crews" value={board.crews.length} big />
          <Stat
            label="Nobody holding"
            value={board.unassigned}
            tone={board.unassigned ? "warn" : undefined}
            big
          />
          <Stat
            label="No serial"
            value={board.noSerial}
            tone={board.noSerial ? "warn" : undefined}
            big
          />
        </div>
      </div>

      {/* ───── band 3: the payload ───── */}
      <div className="relative flex min-h-0 flex-1">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-hidden">
          <table className="sti-grid w-full table-fixed border-collapse">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b">
                <Th className="w-[9rem]">Tag</Th>
                <Th>Tool</Th>
                <Th className="w-[11rem]">Serial</Th>
                <Th className="w-[14rem]">Held by</Th>
                <Th className="w-[9rem]">Condition</Th>
                <Th className="w-[10rem]">Status</Th>
              </tr>
            </thead>
            <tbody>
              {board.tools.length === 0 ? (
                <tr style={{ height: ROW_H * 3 }}>
                  <td colSpan={6} className="px-4 text-center text-sm text-muted-foreground">
                    No tools charged to this job.
                  </td>
                </tr>
              ) : (
                board.tools.map((t, i) => (
                  <tr
                    key={t.id}
                    style={{ height: ROW_H }}
                    className={cn("border-b border-border/40", i % 2 ? "bg-muted/20" : "")}
                  >
                    <Td>
                      <Tag>{t.tag}</Tag>
                    </Td>
                    <Td className="truncate text-foreground">{t.name}</Td>
                    <Td className="truncate font-mono text-muted-foreground">
                      {t.serial ?? <span className="text-warn">no serial</span>}
                    </Td>
                    <Td
                      className={cn(
                        "truncate",
                        t.custodian === "—" ? "text-warn" : "text-foreground",
                      )}
                    >
                      {t.custodian}
                    </Td>
                    <Td className="capitalize text-muted-foreground">{t.condition ?? "—"}</Td>
                    <Td>
                      <StatusPill status={t.status} />
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Fixed scroll rail. The dots below give position in the SET; this
            gives position in the list, which is the question somebody who
            arrived mid-cycle is actually asking. */}
        <div className="relative w-1.5 shrink-0 bg-muted/30">
          <div ref={thumbRef} className="absolute inset-x-0 rounded-full bg-primary/60" />
        </div>
      </div>

      {/* ───── band 4: tools per custodian ───── */}
      <div className="flex h-[44px] shrink-0 items-center gap-2 overflow-hidden border-t bg-card px-6">
        {board.crews.length === 0 ? (
          <span className="text-sm text-muted-foreground">Nobody is holding tools on this job.</span>
        ) : (
          board.crews.map((c) => (
            <span
              key={c.name}
              className="flex shrink-0 items-center gap-2 rounded-sm border bg-muted/40 px-2.5 py-1"
            >
              <span className="text-sm text-foreground">{c.name}</span>
              <span className="font-mono text-sm font-bold text-primary">{c.count}</span>
            </span>
          ))
        )}
        {board.unassigned ? (
          <span className="ml-auto shrink-0 font-mono text-sm uppercase tracking-[0.1em] text-warn">
            {num(board.unassigned)} with nobody
          </span>
        ) : null}
      </div>

      {/* ───── band 5: transport ───── */}
      <div className="relative flex min-h-[68px] shrink-0 items-center gap-6 border-t bg-card px-6 py-2">
        {/* Progress runs along the top edge of the band, so the eye finds it
            without it competing with the names either side. */}
        <div className="absolute inset-x-0 top-0 h-0.5 bg-muted/40">
          <div ref={progressRef} className="h-full bg-primary" style={{ width: 0 }} />
        </div>

        <button
          type="button"
          onClick={() => step(-1)}
          className="flex min-w-0 max-w-[28%] items-center gap-2 text-left text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-5 shrink-0" />
          {/* Code on top, name beneath. It showed one OR the other — a coalesce
              on `code ?? name` — so a job with a cost code never showed what it
              was called, and somebody who arrived mid-cycle got a bare number
              for the thing coming next. Both, always. */}
          <span className="min-w-0">
            <span className="label-xs block">Previous</span>
            <span className="tnum block truncate font-mono text-sm font-semibold">
              {prev.code ?? "No code"}
            </span>
            <span className="block truncate text-[13px] text-muted-foreground">{prev.name}</span>
          </span>
        </button>

        <div className="mx-auto flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            {boards.map((b, i) => (
              <button
                key={b.id}
                type="button"
                aria-label={b.name}
                onClick={() => goto(i)}
                className={cn(
                  "size-2 rounded-full transition-colors",
                  i === safeIndex ? "bg-primary" : "bg-muted-foreground/35 hover:bg-muted-foreground/60",
                )}
              />
            ))}
          </div>
          <span className="font-mono text-sm uppercase tracking-[0.14em] text-muted-foreground tnum">
            {paused ? "held" : `next in ${remaining}s`}
          </span>
        </div>

        <button
          type="button"
          onClick={() => step(1)}
          className="flex min-w-0 max-w-[28%] items-center justify-end gap-2 text-right text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="min-w-0">
            <span className="label-xs block">Next up</span>
            <span className="tnum block truncate font-mono text-sm font-semibold">
              {next.code ?? "No code"}
            </span>
            <span className="block truncate text-[13px] text-muted-foreground">{next.name}</span>
          </span>
          <ChevronRight className="size-5 shrink-0" />
        </button>
      </div>
    </div>
  );
}

/* A whole-screen message. The board's bands only make sense with a job on them,
   so every empty and error state replaces the lot rather than leaving four
   empty bands framing an apology. */
function Band({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center bg-background px-8 text-center">{children}</div>
  );
}

function Stat({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: number;
  tone?: "warn" | "crit";
  big?: boolean;
}) {
  return (
    <div className="shrink-0">
      <div className="label-xs">{label}</div>
      <div
        className={cn(
          "font-mono font-bold leading-tight tnum",
          big ? "text-lg" : "text-[15px]",
          tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : "text-foreground",
        )}
      >
        {num(value)}
      </div>
    </div>
  );
}

/* Rendered client-side only after mount: the server has no idea what time it is
   where the screen is hanging, and a hydration mismatch on a board that never
   reloads would sit there wrong until somebody power-cycled the TV. */
function Clock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const write = () =>
      setNow(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    write();
    const id = setInterval(write, 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="shrink-0 font-mono text-[15px] font-bold tabular-nums text-foreground">
      {now ?? "--:--"}
    </span>
  );
}

function Control({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-sm border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted/50 hover:text-foreground"
    >
      {children}
    </button>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn("label-xs px-4 py-2.5 text-left font-normal", className)}>{children}</th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 text-sm", className)}>{children}</td>;
}
