"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, CloudSun, Sparkles, Sun, Sunset } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useThemeStore } from "@/lib/themes/store";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  The command-center widgets (docs/19).

  Each widget is one small card reading one query. Visibility is per-user,
  persisted in user_preferences.dashboard and mirrored through the theme store
  so the dashboard reacts instantly to the Customize menu.

  Weather is Open-Meteo — free, no API key, no geolocation prompt. The yard
  city is a constant for now (Dallas); the widget degrades silently if the
  fetch fails, because a weather card that errors must not error the dashboard.
*/

export const WIDGET_DEFS = [
  { id: "inbox", label: "Inbox status" },
  { id: "capital", label: "Capital split" },
  { id: "status", label: "Fleet by status" },
  { id: "movements", label: "Movement rate" },
  { id: "greeting", label: "Greeting" },
  { id: "weather", label: "Weather" },
] as const;

export type WidgetId = (typeof WIDGET_DEFS)[number]["id"];

const DEFAULT_VISIBLE: Record<WidgetId, boolean> = {
  inbox: true,
  capital: true,
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
              <Tooltip formatter={(v) => num(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="tnum text-lg font-semibold">{num(total)}</div>
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

/* ---- greeting ---- */
export function GreetingWidget({ firstName }: { firstName: string }) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const Icon = h < 12 ? Sun : h < 17 ? Sun : Sunset;
  return (
    <Card title={part}>
      <div className="flex items-center gap-3">
        <Icon className="size-6 text-warn" />
        <div className="flex flex-col">
          <span className="text-lg font-semibold">{firstName}</span>
          <span className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </span>
        </div>
      </div>
    </Card>
  );
}

/* ---- weather ---- */
const YARD = { city: "Dallas", lat: 32.7767, lng: -96.797 };

type Weather = { temp: number; code: number; label: string };

const WEATHER_CODES: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Icy fog", 51: "Drizzle", 61: "Rain", 63: "Rain", 71: "Snow", 80: "Showers", 95: "Storm",
};

export function WeatherWidget() {
  const [w, setW] = useState<Weather | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${YARD.lat}&longitude=${YARD.lng}&current_weather=true&temperature_unit=fahrenheit`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("weather fetch failed"))))
      .then((j) => {
        if (!live || !j?.current_weather) return;
        const cw = j.current_weather as { temperature: number; weathercode: number };
        setW({ temp: Math.round(cw.temperature), code: cw.weathercode, label: WEATHER_CODES[cw.weathercode] ?? "—" });
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => { live = false; };
  }, []);

  /* Silent degradation: a yard on bad signal must not see a broken dashboard
     because the weather API was unreachable. */
  if (failed) return null;

  return (
    <Card title={`Weather · ${YARD.city}`}>
      <div className="flex items-center gap-3">
        <CloudSun className="size-6 text-warn" />
        <div className="flex flex-col">
          <span className="tnum text-lg font-semibold">{w ? `${w.temp}°F` : "—"}</span>
          <span className="text-sm text-muted-foreground">{w ? w.label : "Checking…"}</span>
        </div>
      </div>
    </Card>
  );
}
