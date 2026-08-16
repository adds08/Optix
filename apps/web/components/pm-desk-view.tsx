"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Plus, Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { relative } from "@/lib/format";

/*
  Request Desk — the PM Desk concept from
  `design/claude-design/PM Desk.dc.html`, wired into the Inbox so the client can
  compare it against the existing three-bucket inbox.

  The design's theme tokens ARE the app's globals.css tokens (the concept file
  copies :root/.dark verbatim), so this view follows the app's light/dark theme
  — no scoped palette needed, unlike the Blocky jobsite view.

  Adaptations where the concept mocks fields the domain does not hold:
    - request kinds (equipment / tools / work / repair) map onto the task's
      actionType when present, else a department-derived bucket,
    - "need by" maps onto task.dueDate (the concept's Today/Mon chip),
    - "stops work" maps onto priority (urgent = stopping work),
    - "chased" maps onto the real escalation_count the request worker writes,
    - desk routing (department / vendor) maps onto task.department,
    - the ask pane is keyword logic over the real task list (the design's own
      answerFor is the same shape — no LLM call needed for a concept view).
*/

type Kind = "all" | "equipment" | "tools" | "work" | "repair";

const KIND_LABEL: Record<Kind, string> = {
  all: "All",
  equipment: "Equipment",
  tools: "Small tools",
  work: "Pending work",
  repair: "Repair & maint.",
};

const KIND_COLOR: Record<string, string> = {
  equipment: "var(--color-accent)",
  tools: "var(--color-ok)",
  work: "var(--color-warn)",
  repair: "var(--color-idle)",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--color-warn)",
  in_progress: "var(--color-accent)",
  completed: "var(--color-ok)",
  cancelled: "var(--color-idle)",
};

const DEPTS = ["All depts", "Procurement", "Equipment Yard", "Maintenance", "Project team"];

function kindOf(item: { actionType: string | null; department: string | null }): Kind {
  const a = item.actionType?.toLowerCase() ?? "";
  const d = item.department?.toLowerCase() ?? "";
  if (a.includes("repair") || a.includes("maintenance") || d.includes("maintenance") || d.includes("shop")) return "repair";
  if (a.includes("purchase") || a.includes("order") || a.includes("procure") || d.includes("procurement")) return "equipment";
  if (a.includes("assign") || a.includes("transfer") || a.includes("return") || a.includes("tool")) return "tools";
  if (a.includes("work") || a.includes("project")) return "work";
  if (d.includes("maintenance")) return "repair";
  return "work";
}

function bucketOf(k: Kind, task: { department: string | null }): string {
  const d = task.department;
  if (k === "repair") return "Maintenance";
  if (d && DEPTS.includes(d)) return d;
  if (d) return d;
  return "Project team";
}

export function PmDeskView() {
  const tasks = trpc.task.list.useQuery({ limit: 100 });
  const projects = trpc.project.list.useQuery();
  const utils = trpc.useUtils();
  const createTask = trpc.task.create.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate();
      utils.inbox.classified.invalidate();
    },
  });

  const [tab, setTab] = useState<Kind>("all");
  const [dept, setDept] = useState("All");
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [answer, setAnswer] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [draft, setDraft] = useState<{
    job: string;
    kind: Kind;
    item: string;
    qty: string;
    needBy: string;
    priority: "low" | "medium" | "high" | "urgent";
    note: string;
  }>({
    job: "",
    kind: "equipment",
    item: "",
    qty: "1",
    needBy: "This week",
    priority: "medium",
    note: "",
  });

  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4200);
  };

  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects.data ?? []) m.set(p.id, p.name);
    return m;
  }, [projects.data]);

  const projectCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects.data ?? []) if (p.externalId) m.set(p.id, p.externalId);
    return m;
  }, [projects.data]);

  /* ---- requests: the real task list, shaped like the concept ---- */
  const all = useMemo(() => {
    return (tasks.data?.items ?? []).map((t) => {
      const kind = kindOf(t);
      const ageDays = Math.max(0, Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86_400_000));
      const due = t.dueDate ? new Date(t.dueDate) : null;
      const dueChip = !due
        ? "—"
        : due.getTime() - Date.now() < 86_400_000 && due.getTime() > Date.now()
          ? "Today"
          : `${due.getMonth() + 1}/${due.getDate()}`;
      const stops = t.priority === "urgent" || t.priority === "high";
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        department: t.department,
        actionType: t.actionType,
        projectId: t.relatedProjectId,
        project: t.relatedProjectId ? projectName.get(t.relatedProjectId) ?? "Unknown job" : "No job",
        code: t.relatedProjectId ? projectCode.get(t.relatedProjectId) ?? "" : "",
        kind,
        dept: bucketOf(kind, t),
        age: ageDays,
        needBy: dueChip,
        stops,
        chases: t.escalationCount ?? 0,
        created: relative(t.createdAt),
      };
    });
  }, [tasks.data, projectName, projectCode]);

  /* ---- filtering ---- */
  const list = useMemo(() => {
    let rows = all;
    if (tab !== "all") rows = rows.filter((r) => r.kind === tab);
    if (dept !== "All") rows = rows.filter((r) => r.dept === dept);
    if (focus === "stopped") rows = rows.filter((r) => r.stops);
    if (focus === "aged") rows = rows.filter((r) => r.age >= 7);
    if (focus === "today") rows = rows.filter((r) => r.needBy === "Today");
    if (focus === "shop") rows = rows.filter((r) => r.dept === "Maintenance");
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((r) => `${r.title} ${r.project} ${r.department ?? ""} ${r.actionType ?? ""}`.toLowerCase().includes(q));
    return rows;
  }, [all, tab, dept, focus, query]);

  /* ---- board counts (unfiltered, like the design) ---- */
  const board = useMemo(() => {
    const defs: { key: string | null; label: string; color: string; n: number }[] = [
      { key: "stopped", label: "WORK STOPPED", color: "var(--color-crit)", n: all.filter((r) => r.stops).length },
      { key: "today", label: "NEEDED TODAY", color: "var(--color-warn)", n: all.filter((r) => r.needBy === "Today").length },
      { key: "aged", label: "OPEN OVER 7 DAYS", color: "var(--color-warn)", n: all.filter((r) => r.age >= 7).length },
      { key: "shop", label: "IN THE SHOP", color: "var(--color-idle)", n: all.filter((r) => r.dept === "Maintenance").length },
      { key: null, label: "OPEN REQUESTS", color: "var(--color-foreground)", n: all.length },
      { key: null, label: "JOBS AFFECTED", color: "var(--color-foreground)", n: new Set(all.map((r) => r.project)).size },
    ];
    return defs.map((d) => ({
      ...d,
      on: focus === d.key,
      style: cn(
        "flex-1 cursor-pointer border-b px-5 py-3.5",
        focus === d.key && "border-b-2 !border-b-primary bg-accent/40",
      ),
      pick: () => (d.key ? setFocus((f) => (f === d.key ? null : d.key)) : setFocus(null)),
    }));
  }, [all, focus]);

  /* ---- job grouping ---- */
  const jobs = useMemo(() => {
    const byJob: { name: string; code: string; rows: typeof list }[] = [];
    list.forEach((r) => {
      let g = byJob.find((x) => x.name === r.project);
      if (!g) {
        g = { name: r.project, code: r.code, rows: [] };
        byJob.push(g);
      }
      g.rows.push(r);
    });
    byJob.sort(
      (a, b) =>
        b.rows.filter((r) => r.stops).length - a.rows.filter((r) => r.stops).length ||
        b.rows.length - a.rows.length ||
        a.name.localeCompare(b.name),
    );
    return byJob;
  }, [list]);

  /* ---- ask pane: the design's answerFor, over the real list ---- */
  const answerFor = useMemo(() => {
    if (!answer.trim()) return null;
    const q = answer.toLowerCase();
    const has = (...w: string[]) => w.some((x) => q.includes(x));
    let rows: typeof all = [];
    let scope = "";
    let text = "";
    let facts: [string, string, string?][] = [];
    let focusK: string | null = null;
    let tabK: Kind = "all";

    if (has("stop", "block", "down", "critical", "today")) {
      rows = all.filter((r) => r.stops).sort((a, b) => b.age - a.age);
      focusK = "stopped";
      scope = `WORK STOPPED · ${rows.length} ITEMS`;
      text = `${rows.length} item${rows.length === 1 ? " is" : "s are"} holding crews right now across ${
        new Set(rows.map((r) => r.project)).size
      } job${new Set(rows.map((r) => r.project)).size === 1 ? "" : "s"}. Anything marked urgent stops the clock for that crew.`;
      facts = [
        ["STOPPED", String(rows.length), "var(--color-crit)"],
        ["JOBS", String(new Set(rows.map((r) => r.project)).size)],
        ["OLDEST", rows.length ? `${Math.max(...rows.map((r) => r.age))}d` : "—", "var(--color-warn)"],
      ];
    } else if (has("week", "7 day", "old", "aging", "sitting", "stale")) {
      rows = all.filter((r) => r.age >= 7).sort((a, b) => b.age - a.age);
      focusK = "aged";
      scope = "OPEN 7+ DAYS";
      text = `${rows.length} request${rows.length === 1 ? " has" : "s have"} aged past a week. The request worker chases these on a widening interval — after 1h, then daily, up to 4 times.`;
      facts = [
        ["OVER 7D", String(rows.length), "var(--color-warn)"],
        ["SHOP ITEMS", String(rows.filter((r) => r.dept === "Maintenance").length), "var(--color-idle)"],
        ["AVG", rows.length ? `${Math.round(rows.reduce((a, r) => a + r.age, 0) / rows.length)}d` : "—"],
      ];
    } else if (has("shop", "repair", "maint", "part")) {
      rows = all.filter((r) => r.kind === "repair").sort((a, b) => b.age - a.age);
      tabK = "repair";
      scope = "REPAIR & MAINTENANCE";
      text = `${rows.length} repair item${rows.length === 1 ? "" : "s"} in the system. The Maintenance desk owns these; crews flag what is hurting them.`;
      facts = [
        ["QUEUE", String(rows.length)],
        ["OVER 7D", String(rows.filter((r) => r.age >= 7).length), "var(--color-warn)"],
      ];
    } else if (has("tool")) {
      rows = all.filter((r) => r.kind === "tools").sort((a, b) => b.age - a.age);
      tabK = "tools";
      scope = "SMALL TOOLS";
      text = `${new Set(rows.map((r) => r.project)).size} job${new Set(rows.map((r) => r.project)).size === 1 ? "" : "s"} waiting on ${rows.length} small-tool request${rows.length === 1 ? "" : "s"}.`;
      facts = [
        ["REQUESTS", String(rows.length)],
        ["JOBS", String(new Set(rows.map((r) => r.project)).size)],
      ];
    } else if (has("equipment", "rental", "order")) {
      rows = all.filter((r) => r.kind === "equipment").sort((a, b) => b.age - a.age);
      tabK = "equipment";
      scope = "EQUIPMENT ORDERS";
      text = `${rows.length} equipment request${rows.length === 1 ? "" : "s"} across ${new Set(rows.map((r) => r.project)).size} job${new Set(rows.map((r) => r.project)).size === 1 ? "" : "s"}.`;
      facts = [
        ["OPEN", String(rows.length)],
        ["HARD DOWN", String(rows.filter((r) => r.stops).length), "var(--color-crit)"],
      ];
    } else {
      rows = all.slice().sort((a, b) => Number(b.stops) - Number(a.stops) || b.age - a.age);
      scope = "EVERYTHING OPEN";
      text = `${rows.length} open request${rows.length === 1 ? "" : "s"} on ${new Set(rows.map((r) => r.project)).size} job${new Set(rows.map((r) => r.project)).size === 1 ? "" : "s"}. ${rows.filter((r) => r.stops).length} stopping work, ${rows.filter((r) => r.age >= 7).length} past a week. Ask about a job, a department, or what is stopping work.`;
      facts = [
        ["OPEN", String(rows.length)],
        ["STOPPED", String(rows.filter((r) => r.stops).length), "var(--color-crit)"],
        ["OVER 7D", String(rows.filter((r) => r.age >= 7).length), "var(--color-warn)"],
      ];
    }
    return { rows: rows.slice(0, 8), text, scope, facts, focus: focusK, tab: tabK };
  }, [answer, all]);

  const prompts = [
    "What's stopping work today?",
    "Anything open over a week?",
    "What does the shop owe the field?",
    "Who needs small tools?",
  ];

  const chip = (on: boolean) =>
    cn(
      "inline-flex cursor-pointer items-center gap-1.5 rounded border px-2.5 text-xs",
      on ? "border-border bg-muted font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground",
    );

  const filtered = tab !== "all" || dept !== "All" || !!focus || !!query;

  return (
    <div className="flex h-[calc(100dvh-220px)] min-h-[520px] flex-col overflow-hidden rounded-md border bg-background">
      {/* ---- bar 1: header ---- */}
      <div className="flex h-14 flex-none items-center gap-3.5 border-b bg-card px-6">
        <div className="grid size-8 place-items-center rounded-md bg-primary font-mono text-xs font-bold text-primary-foreground">SI</div>
        <div>
          <div className="text-base font-bold leading-tight tracking-tight">Request Desk</div>
          <div className="text-[11.5px] text-muted-foreground">Every open request, every job, right now</div>
        </div>
        <div className="flex-1" />
        <div className="flex h-8 w-56 items-center gap-2 rounded border bg-muted/40 px-2.5">
          <Search className="size-3.5 flex-none text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="min-w-0 flex-1 border-none bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="cursor-pointer text-muted-foreground">
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setNewOpen(true);
            setDraft((d) => ({ ...d, job: all[0]?.project ?? "" }));
          }}
          className="flex h-8 flex-none items-center gap-1.5 rounded bg-primary px-3 text-xs font-semibold text-primary-foreground"
        >
          <Plus className="size-3.5" /> New request
        </button>
        <span className="ml-1 border-l pl-1.5 text-xs text-muted-foreground">Request desk</span>
      </div>

      {/* ---- bar 2: status board ---- */}
      <div className="flex flex-none bg-card">
        {board.map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={b.pick}
            className={cn("flex-1 cursor-pointer border-b px-5 py-3.5 text-left", b.on && "border-b-2 border-b-primary bg-accent/40")}
          >
            <div className="tnum text-2xl font-bold leading-none tracking-tight" style={{ color: b.color }}>
              {b.n}
            </div>
            <div className="label-xs mt-2">{b.label}</div>
          </button>
        ))}
      </div>

      {/* ---- bar 3: filters ---- */}
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b bg-background px-5 py-2">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={chip(tab === k)}>
            <span className="size-1.5 flex-none rounded-[2px]" style={{ background: k === "all" ? "transparent" : KIND_COLOR[k] }} />
            {KIND_LABEL[k]}
            <span className="font-mono text-[10px] text-muted-foreground">{k === "all" ? all.length : all.filter((r) => r.kind === k).length}</span>
          </button>
        ))}
        <div className="mx-2 h-4 w-px bg-border" />
        {DEPTS.map((d) => (
          <button key={d} type="button" onClick={() => setDept(d === "All depts" ? "All" : d)} className={chip(dept === (d === "All depts" ? "All" : d))}>
            {d}
          </button>
        ))}
        <div className="flex-1" />
        {filtered ? (
          <button type="button" onClick={() => { setTab("all"); setDept("All"); setFocus(null); setQuery(""); }} className="mr-2.5 cursor-pointer text-[11.5px] text-primary">
            Clear filters
          </button>
        ) : null}
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
          {list.length} of {all.length} requests · {jobs.length} jobs
        </span>
      </div>

      {/* ---- main ---- */}
      <div className="flex min-h-0 flex-1">
        {/* left: jobs */}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-3.5">
          {jobs.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Nothing matches these filters.</div>
          ) : (
            jobs.map((j) => {
              const open = !closed[j.name];
              const stops = j.rows.filter((r) => r.stops).length;
              const oldest = Math.max(...j.rows.map((r) => r.age));
              const mix: [Kind, string][] = [
                ["equipment", "equipment"],
                ["tools", "tools"],
                ["work", "pending work"],
                ["repair", "in repair"],
              ];
              return (
                <div key={j.name} className="flex-none overflow-hidden rounded-md border bg-card">
                  <div onClick={() => setClosed((c) => ({ ...c, [j.name]: !c[j.name] }))} className="flex flex-wrap cursor-pointer items-center gap-2.5 px-4 py-3">
                    <span className="size-2 flex-none rounded-full" style={{ background: stops ? "var(--color-crit)" : oldest >= 7 ? "var(--color-warn)" : "var(--color-ok)" }} />
                    <svg
                      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
                      strokeLinecap="round" strokeLinejoin="round" className="flex-none text-muted-foreground"
                      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}
                    >
                      <path d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight text-foreground">{j.name}</span>
                    {j.code ? <span className="font-mono text-[10px] text-muted-foreground">{j.code}</span> : null}
                    <div className="flex-1" />
                    {stops > 0 ? (
                      <span className="rounded border border-crit bg-crit-bg px-2 py-0.5 text-[11px] font-semibold text-crit">
                        {stops} stopping work
                      </span>
                    ) : null}
                    <div className="flex items-center gap-1.5">
                      {mix
                        .map(([k, word]) => ({ k, word, n: j.rows.filter((r) => r.kind === k).length }))
                        .filter((m) => m.n > 0)
                        .map((m) => (
                          <span key={m.k} className="whitespace-nowrap rounded border bg-muted/50 px-2 py-0.5 text-[11px] font-semibold" style={{ color: KIND_COLOR[m.k] }}>
                            {m.n} {m.word}
                          </span>
                        ))}
                    </div>
                    <span className="w-[62px] text-right text-[11.5px] text-muted-foreground">{j.rows.length} open</span>
                  </div>

                  {open ? (
                    <div>
                      {j.rows
                        .slice()
                        .sort((a, b) => Number(b.stops) - Number(a.stops) || b.age - a.age)
                        .map((r) => {
                          const isOpen = openRow === r.id;
                          return (
                            <div key={r.id}>
                              <div onClick={() => setOpenRow((o) => (o === r.id ? null : r.id))} className="flex cursor-pointer items-center gap-2.5 border-t bg-card px-4 py-2.5">
                                <span className="size-1.5 flex-none rounded-[2px]" style={{ background: KIND_COLOR[r.kind] }} />
                                <span className="min-w-[120px] flex-1 truncate text-[13px] text-foreground">{r.title}</span>
                                <span
                                  className={cn(
                                    "flex-none whitespace-nowrap rounded px-1.5 text-[11px] font-semibold",
                                    r.kind === "repair" ? "text-accent-foreground" : "text-muted-foreground",
                                  )}
                                  style={
                                    r.kind === "repair"
                                      ? { background: "var(--color-accent)", border: "1px solid var(--color-accent)" }
                                      : { background: "var(--color-muted)", border: "1px solid var(--color-border)" }
                                  }
                                >
                                  {r.dept}
                                </span>
                                <span className={cn("w-14 flex-none text-[12px]", r.needBy === "Today" && "font-semibold text-crit")}>{r.needBy}</span>
                                <span className={cn("tnum w-8 flex-none text-right font-mono text-[11px]", r.age >= 7 && "font-semibold text-warn")}>{r.age}d</span>
                                <span className="w-[86px] flex-none text-right text-[11px] font-semibold" style={{ color: STATUS_COLOR[r.status] }}>
                                  {STATUS_LABEL[r.status] ?? r.status}
                                </span>
                              </div>
                              {isOpen ? (
                                <div className="flex items-start gap-7 border-t bg-muted/30 px-4 py-3.5 pl-9">
                                  <div className="min-w-0 flex-1">
                                    <p className="max-w-[560px] text-[13px] leading-relaxed text-foreground">
                                      {r.description ?? "No note."}
                                    </p>
                                    <div className="mt-3 flex gap-2">
                                      <button type="button" className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                                        {r.kind === "repair" ? "Chase the shop" : r.kind === "work" ? "Escalate" : "Approve & order"}
                                      </button>
                                      <button type="button" className="rounded border px-3 py-1.5 text-xs text-foreground">Comment</button>
                                    </div>
                                  </div>
                                  <div className="flex w-[220px] flex-none flex-col gap-2">
                                    {[
                                      ["DESK", r.dept],
                                      ["STATUS", STATUS_LABEL[r.status] ?? r.status],
                                      ["NEEDED", r.needBy],
                                      ["CHASED", r.chases === 0 ? "Not yet" : `${r.chases}× by the request worker`],
                                      ["REQUESTED", `${r.age}d ago`],
                                      ["IMPACT", r.stops ? "Crew standing down" : "Working around it"],
                                    ].map(([label, value]) => (
                                      <div key={label} className="flex gap-2.5">
                                        <span className="label-xs w-[74px] flex-none pt-0.5">{label}</span>
                                        <span className={cn("text-xs", label === "IMPACT" && r.stops ? "text-crit" : "text-foreground")}>{value}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* right: ask the desk */}
        <div className="flex min-h-0 w-[400px] flex-none flex-col border-l bg-card">
          <div className="flex flex-none items-baseline gap-2 px-4 pt-3.5">
            <span className="text-sm font-bold text-foreground">Ask the desk</span>
            <span className="text-[11.5px] text-muted-foreground">answers from the {all.length} open requests</span>
          </div>
          <div className="flex-none px-4 pt-3.5">
            <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 pl-3">
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setAnswer(ask); }}
                placeholder="What's stopping work today?"
                className="min-w-0 flex-1 border-none bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              />
              <button type="button" onClick={() => setAnswer(ask)} className="mr-1 flex h-6 items-center rounded bg-primary px-3 text-xs font-semibold text-primary-foreground">
                Ask
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {prompts.map((p) => (
                <button key={p} type="button" onClick={() => { setAsk(p); setAnswer(p); }} className="cursor-pointer rounded-full border bg-muted/40 px-2.5 py-1 text-[11.5px] text-foreground">
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {answerFor ? (
              <div className="px-4 pb-5 pt-1">
                <p className="text-[13.5px] leading-relaxed text-foreground">{answerFor.text}</p>
                <div className="mt-3.5 grid grid-cols-3 gap-2">
                  {answerFor.facts.map(([label, value, color]) => (
                    <div key={label} className="rounded-md border bg-muted/40 px-2.5 py-2">
                      <div className="tnum text-xl font-bold leading-none tracking-tight" style={{ color: color ?? "var(--color-foreground)" }}>
                        {value}
                      </div>
                      <div className="label-xs mt-1.5">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="label-xs mb-2 mt-4">{answerFor.scope}</div>
                <div className="overflow-hidden rounded-md border">
                  {answerFor.rows.map((r, i) => (
                    <div key={r.id} className={cn("px-2.5 py-2", i % 2 ? "bg-muted/30" : "bg-card", i && "border-t")}>
                      <div className="flex items-center gap-2">
                        <span className="size-1.5 flex-none rounded-[2px]" style={{ background: KIND_COLOR[r.kind] }} />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{r.title}</span>
                        <span className="tnum flex-none font-mono text-[10.5px] text-muted-foreground">{r.age}d</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 pl-4">
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">{r.project}</span>
                        <span className="flex-none text-[11px] font-semibold" style={{ color: STATUS_COLOR[r.status] }}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (answerFor.focus) setFocus((f) => (f === answerFor.focus ? null : answerFor.focus));
                    setTab(answerFor.tab);
                    setDept("All");
                    setQuery("");
                  }}
                  className="mt-3 cursor-pointer text-xs font-semibold text-primary"
                >
                  Apply this as a filter on the board →
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---- toast ---- */}
      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2.5 rounded-md border bg-card px-4 py-2.5 text-[13px] font-semibold text-foreground shadow-xl">
          <span className="size-2 rounded-full bg-ok" />
          {toast}
        </div>
      ) : null}

      {/* ---- new request drawer ---- */}
      {newOpen ? (
        <div className="fixed inset-0 z-50 flex bg-background/60">
          <div className="flex-1" onClick={() => setNewOpen(false)} />
          <div className="flex min-h-0 w-[520px] flex-none flex-col border-l bg-background shadow-2xl">
            <div className="flex flex-none items-start gap-2.5 border-b bg-card px-5 py-4">
              <div>
                <div className="text-[17px] font-bold tracking-tight">New request</div>
                <div className="mt-1 text-xs text-muted-foreground">Raised unassigned. A desk claims it — nothing here auto-approves.</div>
              </div>
              <div className="flex-1" />
              <button type="button" onClick={() => setNewOpen(false)} aria-label="Close" className="cursor-pointer text-lg leading-none text-muted-foreground">
                ×
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              <div className="flex flex-col">
                <div className="label-xs mb-2">JOB</div>
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set(all.map((r) => r.project))].slice(0, 10).map((n) => (
                    <button key={n} type="button" onClick={() => setDraft((d) => ({ ...d, job: n }))} className={chip(draft.job === n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col">
                <div className="label-xs mb-2">WHAT KIND OF REQUEST</div>
                <div className="flex flex-wrap gap-1.5">
                  {(["equipment", "tools", "work", "repair"] as Kind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, kind: k }))}
                      className={chip(draft.kind === k)}
                    >
                      <span className="size-1.5 flex-none rounded-[2px]" style={{ background: KIND_COLOR[k] }} />
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col">
                <div className="label-xs mb-2">WHAT DO YOU NEED</div>
                <div className="flex gap-2">
                  <input
                    value={draft.item}
                    onChange={(e) => setDraft((d) => ({ ...d, item: e.target.value }))}
                    placeholder="e.g. Rough terrain forklift 8k 4wd"
                    className="h-9 min-w-0 flex-1 rounded-md border bg-muted/40 px-3 text-[13px] outline-none placeholder:text-muted-foreground"
                  />
                  <input
                    value={draft.qty}
                    onChange={(e) => setDraft((d) => ({ ...d, qty: e.target.value }))}
                    placeholder="Qty"
                    className="h-9 w-[70px] flex-none rounded-md border bg-muted/40 px-3 text-[13px] outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="label-xs mb-2">NEEDED BY</div>
                  <div className="flex flex-wrap gap-1.5">
                    {["Today", "Tomorrow", "This week", "Next week"].map((n) => (
                      <button key={n} type="button" onClick={() => setDraft((d) => ({ ...d, needBy: n }))} className={chip(draft.needBy === n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="label-xs mb-2">URGENCY</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(["low", "medium", "high", "urgent"] as const).map((u) => (
                      <button key={u} type="button" onClick={() => setDraft((d) => ({ ...d, priority: u }))} className={chip(draft.priority === u)}>
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col">
                <div className="label-xs mb-2">NOTES</div>
                <textarea
                  value={draft.note}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                  rows={3}
                  placeholder="What is holding the crew up?"
                  className="resize-none rounded-md border bg-muted/40 px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div className="flex flex-none items-center gap-2.5 border-t bg-card px-5 py-3.5">
              <span className="max-w-[230px] text-[11.5px] leading-snug text-muted-foreground">
                Raised unassigned — a desk claims it. Chased after 1h, then daily.
              </span>
              <div className="flex-1" />
              <button type="button" onClick={() => setNewOpen(false)} className="rounded border px-3.5 py-2 text-[12.5px] text-foreground">
                Cancel
              </button>
              <button
                type="button"
                disabled={!draft.item.trim() || createTask.isPending}
                onClick={() => {
                  const qty = draft.qty && +draft.qty > 1 ? `(${draft.qty}) ` : "";
                  createTask.mutate(
                    {
                      title: `${qty}${draft.item.trim()}`,
                      description: draft.note.trim() || undefined,
                      priority: draft.priority,
                      relatedProjectId: undefined,
                      dueDate: draft.needBy === "Today" ? new Date().toISOString() : undefined,
                    },
                    {
                      onSuccess: () => {
                        setNewOpen(false);
                        setDraft({ job: "", kind: "equipment", item: "", qty: "1", needBy: "This week", priority: "medium", note: "" });
                        showToast(`${draft.item.trim()} raised`);
                      },
                    },
                  );
                }}
                className="flex items-center gap-1.5 rounded bg-primary px-4 py-2 text-[12.5px] font-semibold text-primary-foreground disabled:cursor-default disabled:bg-muted disabled:text-muted-foreground"
              >
                {createTask.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Send request
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
