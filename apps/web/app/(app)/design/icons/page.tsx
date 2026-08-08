"use client";

import {
  Bolt,
  Boxes,
  Building2,
  Hammer,
  HardHat,
  Inbox,
  LayoutDashboard,
  Ruler,
  TriangleAlert,
  Users,
  Wrench,
} from "lucide-react";
import {
  IconBolt,
  IconBox,
  IconBuildingWarehouse,
  IconAlertTriangle,
  IconHammer,
  IconHelmet,
  IconInbox,
  IconLayoutDashboard,
  IconRuler,
  IconTool,
  IconUsers,
} from "@tabler/icons-react";
import { StatusPill, Tag } from "@/components/sti/status";
import { cn } from "@/lib/utils";

/*
  Icon treatment comparison — a design scratch route, deliberately not in
  nav-config so it never shows up in the rail.

  It lives inside the (app) group on purpose: that way it renders against the
  real tokens, so switching theme or dark mode on Settings repaints this page
  too and the comparison holds under every palette rather than only the default.

  Four treatments, the same five surfaces each. Delete this directory once a
  treatment is chosen and applied.
*/

type Treatment = "lucide" | "lucide-heavy" | "tabler" | "none";

const TREATMENTS: { key: Treatment; label: string; note: string }[] = [
  { key: "lucide", label: "Lucide, as-is", note: "What ships today. stroke 2, size-4." },
  { key: "lucide-heavy", label: "Lucide, heavier", note: "stroke 2.25, tinted chip on headings." },
  { key: "tabler", label: "Tabler", note: "Already a dependency. Rounder, more uniform." },
  { key: "none", label: "No icons", note: "Type and spacing only." },
];

/* One glyph per role, per library. `null` is the no-icons column. */
function Glyph({
  role,
  t,
  className,
}: {
  role: "tool" | "hammer" | "ruler" | "power" | "job" | "dash" | "people" | "inbox" | "box" | "warn" | "yard";
  t: Treatment;
  className?: string;
}) {
  if (t === "none") return null;

  const size = cn("size-4 shrink-0", className);

  if (t === "tabler") {
    const map = {
      tool: IconTool,
      hammer: IconHammer,
      ruler: IconRuler,
      power: IconBolt,
      job: IconHelmet,
      dash: IconLayoutDashboard,
      people: IconUsers,
      inbox: IconInbox,
      box: IconBox,
      warn: IconAlertTriangle,
      yard: IconBuildingWarehouse,
    } as const;
    const Icon = map[role];
    return <Icon className={size} stroke={1.75} aria-hidden />;
  }

  const map = {
    tool: Wrench,
    hammer: Hammer,
    ruler: Ruler,
    power: Bolt,
    job: HardHat,
    dash: LayoutDashboard,
    people: Users,
    inbox: Inbox,
    box: Boxes,
    warn: TriangleAlert,
    yard: Building2,
  } as const;
  const Icon = map[role];
  return (
    <Icon
      className={size}
      strokeWidth={t === "lucide-heavy" ? 2.25 : 2}
      aria-hidden
    />
  );
}

const ROWS = [
  { tag: "TOOL-0001", name: "BOSCH 11255VSR Bulldog", role: "hammer", status: "assigned" },
  { tag: "TOOL-0004", name: "STIHL TS-420 Cutquik", role: "power", status: "available" },
  { tag: "TOOL-0012", name: "DEWALT DW089K Laser", role: "ruler", status: "in_maintenance" },
  { tag: "TOOL-0031", name: "MILWAUKEE M18 Impact", role: "tool", status: "lost" },
] as const;

const NAV = [
  { label: "Dashboard", role: "dash", active: false },
  { label: "Tools by Jobsite", role: "yard", active: true },
  { label: "Tool Register", role: "box", active: false },
  { label: "People", role: "people", active: false },
  { label: "Inbox", role: "inbox", active: false },
] as const;

export default function IconComparisonPage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1.5 border-b pb-5">
        <span className="label-xs">Design scratch</span>
        <h1 className="text-2xl font-semibold tracking-tight">Icon treatments</h1>
        <p className="max-w-[62ch] text-sm text-muted-foreground text-pretty">
          The same five surfaces under four treatments. Change the theme or dark mode in Settings
          and this page follows — a treatment that only works in Drafting Ink light is not a
          treatment. Pick a column and the rest of the app gets it.
        </p>
      </header>

      <Surface title="Register rows" hint="The densest surface — 754 of these, scanned not read.">
        {(t) => (
          <div className="overflow-hidden rounded-md border bg-card">
            {ROWS.map((r) => (
              <div key={r.tag} className="flex items-center gap-2 border-b px-3 py-2 last:border-0">
                <Tag>{r.tag}</Tag>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Glyph role={r.role} t={t} className="text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{r.name}</span>
                </span>
                <StatusPill status={r.status} />
              </div>
            ))}
          </div>
        )}
      </Surface>

      <Surface title="Metric cards" hint="Does the glyph help, or is the number already the point?">
        {(t) => (
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { label: "Available", value: "312", role: "box" as const, tone: "" },
              { label: "Lost", value: "4", role: "warn" as const, tone: "text-crit" },
            ].map((m) => (
              <div
                key={m.label}
                className="relative flex flex-col gap-1 overflow-hidden rounded-md border bg-card p-4"
              >
                <span className="flex items-center gap-1.5">
                  <Glyph role={m.role} t={t} className="size-3.5 text-muted-foreground" />
                  <span className="label-xs">{m.label}</span>
                </span>
                <span className={cn("tnum text-3xl font-semibold tracking-tight", m.tone)}>
                  {m.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </Surface>

      <Surface title="Sidebar nav" hint="Icon-only when the rail collapses — legibility at 16px matters most here.">
        {(t) => (
          <div className="flex flex-col gap-0.5 rounded-md border bg-sidebar p-2">
            {NAV.map((n) => (
              <span
                key={n.label}
                className={cn(
                  "relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground",
                  n.active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )}
              >
                {n.active ? (
                  <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary" />
                ) : null}
                <Glyph
                  role={n.role}
                  t={t}
                  className={n.active ? "text-sidebar-primary" : "text-sidebar-foreground/55"}
                />
                <span className="truncate">{n.label}</span>
              </span>
            ))}
          </div>
        )}
      </Surface>

      <Surface title="Page heading" hint="Bare glyph, or a tinted chip that anchors the title?">
        {(t) => (
          <div className="flex items-start gap-3 rounded-md border bg-card p-4">
            {t !== "none" ? (
              t === "lucide-heavy" ? (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-accent text-accent-foreground">
                  <Glyph role="job" t={t} className="size-[1.125rem]" />
                </span>
              ) : (
                <Glyph role="job" t={t} className="mt-1 size-5 text-muted-foreground" />
              )
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="label-xs">Rotary Hammers</span>
              <h3 className="text-xl font-semibold tracking-tight">BOSCH 11255VSR</h3>
              <p className="text-sm text-muted-foreground">Serial 0611255039</p>
            </div>
          </div>
        )}
      </Surface>

      <Surface title="Empty state" hint="The first thing a new user sees on half these screens.">
        {(t) => (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed bg-card/40 px-6 py-10 text-center">
            {t !== "none" ? (
              <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Glyph role="box" t={t} className="size-5" />
              </span>
            ) : null}
            <div className="flex flex-col gap-1">
              <p className="font-medium">No tools on this job</p>
              <p className="text-sm text-muted-foreground">Hand one to a foreman to get started.</p>
            </div>
          </div>
        )}
      </Surface>
    </div>
  );
}

/* One surface, rendered once per treatment across a row so the eye compares
   like with like instead of scrolling between whole mock pages. */
function Surface({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: (t: Treatment) => React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {TREATMENTS.map((t) => (
          <div key={t.key} className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">{t.label}</span>
              <span className="text-[11px] text-muted-foreground">{t.note}</span>
            </div>
            {children(t.key)}
          </div>
        ))}
      </div>
    </section>
  );
}
