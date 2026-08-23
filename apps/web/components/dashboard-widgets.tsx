"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useThemeStore } from "@/lib/themes/store";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  The command-center widgets (docs/19 + docs/20).

  Each widget is one small card reading one query. Visibility is per-user,
  persisted in user_preferences.dashboard and mirrored through the theme store
  so the dashboard reacts instantly to the Customize menu.

  These live on the Command Center tab only (docs/20, B3). The greeting and
  weather moved out into the compact GreetingBar on the Fleet tab.
*/

/*
  `capital` is deliberately absent. The Capital split widget still exists and is
  still a report at /reports/charts/capital-split — it was taken off the Command
  Center because project-versus-department acquisition cost is a finance
  question, not something the desk acts on between jobs. `widgetVisibility`
  iterates this list, so a stored preference still carrying `capital: true` is
  ignored rather than needing a migration.
*/
export const WIDGET_DEFS = [
  { id: "inbox", label: "Inbox status" },
  { id: "status", label: "Fleet by status" },
  { id: "movements", label: "Movement rate" },
  { id: "greeting", label: "Greeting" },
  { id: "weather", label: "Weather" },
] as const;

export type WidgetId = (typeof WIDGET_DEFS)[number]["id"];

const DEFAULT_VISIBLE: Record<WidgetId, boolean> = {
  inbox: true,
  status: true,
  movements: true,
  greeting: true,
  weather: true,
};

export function widgetVisibility(prefs: ReturnType<typeof useThemeStore.getState>["prefs"]): Record<WidgetId, boolean> {
  const stored = prefs?.dashboard.widgets ?? {};
  const out = { ...DEFAULT_VISIBLE } as Record<WidgetId, boolean>;
  for (const w of WIDGET_DEFS) {
    if (typeof stored[w.id] === "boolean") out[w.id] = stored[w.id] as boolean;
  }
  return out;
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-md border bg-card p-4", className)}>
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </div>
  );
}

/* ---- inbox status ---- */
export function InboxStatusWidget() {
  const inbox = trpc.inbox.classified.useQuery({ limit: 20 }, { refetchInterval: 15_000 });
  const c = inbox.data;
  return (
    <Link href="/inbox" className="block rounded-md border bg-card p-4 transition-colors hover:bg-accent/60">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Inbox</h3>
        <Sparkles className="size-3.5 text-warn" />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Stat label="Ready" value={c?.recognized.length ?? "…"} tone={c?.recognized.length ? "text-warn" : "text-ok"} />
        <Stat label="Stuck" value={c?.unrecognized.length ?? "…"} tone={c?.unrecognized.length ? "text-warn" : "text-muted-foreground"} />
        <Stat label="Done" value={c?.completed.length ?? "…"} tone="text-muted-foreground" />
      </div>
      <span className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
        Open the inbox <ArrowRight className="size-3" />
      </span>
    </Link>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("tnum text-xl font-semibold", tone)}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/* ---- charts ---- */
const STATUS_COLORS = [
  "oklch(0.505 0.092 168)",
  "oklch(0.505 0.093 227)",
  "oklch(0.545 0.115 62)",
  "oklch(0.525 0.163 28)",
  "oklch(0.545 0.012 245)",
];

export function CapitalSplitWidget() {
  const charts = trpc.dashboard.charts.useQuery();
  const data = (charts.data?.capitalSplit ?? []).map((c) => ({
    name: c.kind === "department" ? "Department" : "Project",
    value: Number(c.value),
  }));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Card title="Capital split" className="h-52">
      {charts.isLoading || !total ? (
        <p className="m-auto text-sm text-muted-foreground">No capital recorded yet.</p>
      ) : (
        <div className="relative h-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={38} outerRadius={58} paddingAngle={2} strokeWidth={0}>
                {data.map((d, i) => (
                  <Cell key={d.name} fill={i === 0 ? STATUS_COLORS[0] : STATUS_COLORS[1]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => money(Number(v))} />
              {/*
                UI-70: the ring is the *only* place the department/project split was
                stated — no legend, no slice labels — and on real data one slice is
                ~3% of the circle, so it reads as a solid one-colour donut and the
                breakdown was reported as missing. `height` keeps the legend inside
                the existing h-52 card instead of growing the Command Center tile.
              */}
              <Legend
                verticalAlign="bottom"
                height={18}
                /*
                  The label carries the AMOUNT, not just the colour key. Naming
                  the two slices still left "how is the $77,710 divided" — the
                  literal question on the ticket — one hover away, and a 3%
                  slice is not a readable answer on its own.
                */
                formatter={(value, entry) =>
                  `${value} ${money(Number((entry?.payload as { value?: number } | undefined)?.value ?? 0))}`
                }
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Same 18px the legend reserves, so the total stays in the donut hole. */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center pb-[18px]">
            <div className="text-center">
              {/* UI-70: capital is money — num() rendered a dollar sum as a bare "36,134.99" under "total". */}
              <div className="tnum text-lg font-semibold">{money(total)}</div>
              <div className="text-xs text-muted-foreground">total</div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export function StatusWidget() {
  const charts = trpc.dashboard.charts.useQuery();
  const data = (charts.data?.statusDistribution ?? []).map((s, i) => ({
    name: s.status.replace(/_/g, " "),
    count: s.count,
    fill: STATUS_COLORS[i % STATUS_COLORS.length],
  }));
  return (
    <Card title="Fleet by status" className="h-52">
      {charts.isLoading || !data.length ? (
        <p className="m-auto text-sm text-muted-foreground">No assets registered yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={40} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="count" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

export function MovementsWidget() {
  const charts = trpc.dashboard.charts.useQuery();
  const data = (charts.data?.movementsByWeek ?? []).map((m) => ({
    week: m.week.slice(5),
    count: m.count,
  }));
  return (
    <Card title="Movement rate" className="h-52">
      {charts.isLoading || !data.length ? (
        <p className="m-auto text-sm text-muted-foreground">No movements recorded yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <XAxis dataKey="week" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Area type="monotone" dataKey="count" stroke="oklch(0.505 0.093 227)" fill="oklch(0.505 0.093 227 / 0.18)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
