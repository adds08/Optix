"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Handshake, SlidersHorizontal, Star, UserMinus } from "lucide-react";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { isFieldRole } from "@/components/sti/nav-config";
import { Metric, EmptyState } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dateTime, money, num, relative } from "@/lib/format";
import { FleetLegend } from "@/components/fleet-map-view";
import { GreetingBar } from "@/components/greeting-bar";
import { useThemeStore } from "@/lib/themes/store";
import {
  CapitalSplitWidget,
  InboxStatusWidget,
  MovementsWidget,
  StatusWidget,
  WIDGET_DEFS,
  widgetVisibility,
  type WidgetId,
} from "@/components/dashboard-widgets";
import { cn } from "@/lib/utils";

/*
  The desk dashboard (docs/20, B).

  Two tabs instead of one wall:
  - Fleet at a Glance — greeting+weather bar, the work queue beside the fleet
    map, the metrics, and the ledger strip at the bottom.
  - Command Center — the widget grid (inbox status, capital, fleet shape,
    movement rate). No weather here; it lives on the Fleet bar only.

  The star sets which tab opens first; it persists in user_preferences, so the
  desk's personal layout follows them across browsers. The page title is gone —
  the tabs carry the context and the vertical space belongs to the data.

  The fleet map is loaded client-side only (Leaflet touches the DOM on import),
  so it comes in via dynamic and fills in after first paint.
*/
const FleetMapPanel = dynamic(
  () => import("@/components/fleet-map-view").then((m) => m.FleetMapView),
  {
    ssr: false,
    loading: () => <Skeleton className="h-80 w-full rounded-md" />,
  },
);

type Tab = "fleet" | "command";

export default function HomePage() {
  const router = useRouter();
  const { role } = usePermissions();

  /* Field roles get their own landing surface. */
  useEffect(() => {
    if (isFieldRole(role)) router.replace("/my-tools");
  }, [role, router]);

  const kpis = trpc.dashboard.kpis.useQuery();
  const overdue = trpc.dashboard.overdueLoans.useQuery();
  const clearance = trpc.dashboard.clearanceQueue.useQuery();
  const approvals = trpc.dashboard.pendingApprovals.useQuery();
  const activity = trpc.dashboard.recentActivity.useQuery();
  const capitalJobs = trpc.report.capitalByProject.useQuery();
  const capitalShop = trpc.report.capitalByDepartment.useQuery();
  const idleReport = trpc.report.idle.useQuery();
  const me = trpc.identity.me.useQuery();

  const prefs = useThemeStore((s) => s.prefs);
  const setPrefs = useThemeStore((s) => s.setPrefs);
  const utils = trpc.useUtils();

  const defaultTab: Tab = prefs?.dashboard.defaultTab ?? "fleet";
  const [tab, setTab] = useState<Tab>("fleet");
  const touched = useRef(false);
  /* Hydrate the tab from the stored default once — but never stamp over a tab
     the user has already switched to. */
  useEffect(() => {
    if (!touched.current && prefs?.dashboard.defaultTab) setTab(prefs.dashboard.defaultTab);
  }, [prefs]);

  const setDefaultTab = (t: Tab) => {
    const base = prefs ?? {
      themeName: "drafting-ink" as const,
      fontFamily: "system" as const,
      fontScale: "1.0",
      density: "comfortable" as const,
      dashboard: { widgets: {} },
    };
    const next = { ...base, dashboard: { ...base.dashboard, defaultTab: t } };
    setPrefs(next);
    utils.client.preferences.set.mutate(next);
  };

  const visible = widgetVisibility(prefs);
  const toggleWidget = (id: WidgetId, on: boolean) => {
    const base = prefs ?? {
      themeName: "drafting-ink" as const,
      fontFamily: "system" as const,
      fontScale: "1.0",
      density: "comfortable" as const,
      dashboard: { widgets: {} },
    };
    const next = { ...base, dashboard: { ...base.dashboard, widgets: { ...visible, [id]: on } } };
    setPrefs(next);
    utils.client.preferences.set.mutate(next);
  };

  const k = kpis.data;

  /* "Awaiting approval" and "Awaiting verification" are different questions —
     may this happen, versus this happened, is the record right. They share one
     query and split here. */
  const all = approvals.data ?? [];
  const holds = all.filter((a) => a.status === "pending_approval");
  const borrows = all.filter((a) => a.status === "pending_verification");

  const attention =
    (overdue.data?.length ?? 0) + (clearance.data?.length ?? 0) + all.length;

  const capitalOnJobs = (capitalJobs.data ?? []).reduce((s, r) => s + Number(r.capitalValue), 0);
  const capitalInShop = (capitalShop.data ?? []).reduce((s, r) => s + Number(r.capitalValue), 0);
  const idleCount = idleReport.data?.length ?? 0;

  return (
    <div className="flex flex-col gap-1">
      {/* ---- the greeting + weather wash, above everything (docs/20, B2) ----
          Not part of either tab: it is the top of the page, greeting whoever
          opened the dashboard regardless of the view below. */}
      <GreetingBar
        firstName={me.data?.firstName ?? "there"}
        isDefault={defaultTab === "fleet"}
        onSetDefault={() => { touched.current = true; setDefaultTab("fleet"); }}
      />

      {/* ---- tabs: the page's only header ---- */}
      <div className="flex items-center gap-2 border-b pb-3">
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Dashboard view">
          {([["fleet", "Fleet at a Glance"], ["command", "Command Center"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => { touched.current = true; setTab(key); }}
              aria-pressed={tab === key}
              className={cn(
                "px-3.5 py-2 text-sm transition-colors",
                tab === key
                  ? "bg-muted font-medium text-foreground"
                  : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {/* The star, per tab: whichever view is starred opens first. */}
        <button
          type="button"
          onClick={() => { touched.current = true; setDefaultTab(tab); }}
          aria-pressed={defaultTab === tab}
          aria-label={defaultTab === tab ? `${tab} view is your default` : `Make the ${tab} view your default`}
          title="Star this view to open it first"
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
        >
          <Star className={cn("size-4", defaultTab === tab && "fill-warn text-warn")} />
        </button>
      </div>

      {/* `key={tab}` re-mounts the branch so the draw-in animation plays on
          every switch — a tab change is a surface change (docs/20, F). */}
      <div key={tab} className="flex flex-col gap-6 animate-draw-in motion-safe">
        {tab === "fleet" ? (
        <>
          {/* ---- what needs a person (60%) and where the fleet is (40%) ---- */}
          <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
            <section className="flex flex-col gap-3 lg:col-span-3">
              <h2 className="text-sm font-medium">Needs a person</h2>

              {overdue.isLoading || clearance.isLoading || approvals.isLoading ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}
                </div>
              ) : attention === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Nothing is waiting"
                  description="No overdue loans, no clearance queue, and no approvals or hand-offs pending. The yard is square."
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <AttentionCard
                    tone="crit"
                    icon={AlertTriangle}
                    title="Overdue loans"
                    count={overdue.data?.length ?? 0}
                    href="/custody"
                    empty="No loan is past its due date."
                  >
                    {(overdue.data ?? []).slice(0, 4).map((o) => (
                      <Row
                        key={o.id}
                        left={<Tag>{o.tag}</Tag>}
                        mid={o.custodianName ?? "—"}
                        right={
                          <span className="text-crit tnum">
                            {o.daysOverdue}d over
                          </span>
                        }
                      />
                    ))}
                  </AttentionCard>

                  <AttentionCard
                    tone="crit"
                    icon={UserMinus}
                    title="HR clearance"
                    count={clearance.data?.length ?? 0}
                    href="/people"
                    empty="No terminated employee is still holding a tool."
                  >
                    {(clearance.data ?? []).slice(0, 4).map((c, i) => (
                      <Row
                        key={i}
                        left={<Tag>{c.tag}</Tag>}
                        mid={c.custodianName ?? "—"}
                        right={<StatusPill status={c.status} />}
                      />
                    ))}
                  </AttentionCard>

                  <AttentionCard
                    tone="warn"
                    icon={AlertTriangle}
                    title="Awaiting approval"
                    count={holds.length}
                    href="/inbox"
                    empty="No hand-off is waiting on a signature."
                  >
                    {holds.slice(0, 4).map((p) => (
                      <Row
                        key={p.id}
                        left={<Tag>{p.assetTag}</Tag>}
                        mid={`${p.type} · ${p.custodianName ?? "—"}`}
                        right={<span className="text-muted-foreground">{relative(p.createdAt)}</span>}
                      />
                    ))}
                  </AttentionCard>

                  <AttentionCard
                    tone="warn"
                    icon={Handshake}
                    title="Loans to verify"
                    count={borrows.length}
                    href="/inbox"
                    empty="No foreman hand-off is waiting to be checked."
                  >
                    {borrows.slice(0, 4).map((p) => (
                      <Row
                        key={p.id}
                        left={<Tag>{p.assetTag}</Tag>}
                        mid={`${p.fromName ?? "Somebody"} → ${p.custodianName ?? "—"}`}
                        right={<span className="text-muted-foreground">{relative(p.createdAt)}</span>}
                      />
                    ))}
                  </AttentionCard>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-3 lg:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Fleet position</h2>
                <Link href="/map" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  Open full map <ArrowRight className="size-3.5" />
                </Link>
              </div>
              <FleetMapPanel className="h-80" />
              <FleetLegend />
            </section>
          </div>

          {/* ---- the numbers ---- */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Fleet at a glance</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Available" value={num(k?.available)} loading={kpis.isLoading} hint="ready to issue" />
              <Metric label="Assigned" value={num(k?.assigned)} loading={kpis.isLoading} hint="out with a custodian" />
              <Metric label="In maintenance" value={num(k?.inMaintenance)} loading={kpis.isLoading} tone={k?.inMaintenance ? "warn" : "default"} />
              <Metric label="Lost" value={num(k?.lost)} loading={kpis.isLoading} tone={k?.lost ? "crit" : "ok"} hint="unaccounted for" />
              <Metric label="Fleet value" value={money(k?.fleetValue)} loading={kpis.isLoading} hint="acquisition cost" />
              <Metric label="Capital on jobs" value={money(capitalOnJobs)} loading={capitalJobs.isLoading} hint="charged to projects" />
              <Metric label="Capital in the shop" value={money(capitalInShop)} loading={capitalShop.isLoading} hint="charged to departments" />
              <Metric label="Reserved" value={num(k?.reserved)} loading={kpis.isLoading} />
              <Metric
                label="Scheduled maintenance"
                value={num(k?.scheduledMaint)}
                loading={kpis.isLoading}
                hint="maintenance module not built yet"
              />
              <Metric
                label="Missing serials"
                value={num(k?.missingSerial)}
                loading={kpis.isLoading}
                tone={k?.missingSerial ? "warn" : "ok"}
                hint="serialized tools that cannot be identified if stolen"
              />
              <Link href="/reports/idle" className="block transition-opacity hover:opacity-80">
                <Metric
                  label="Idle tools"
                  value={num(idleCount)}
                  loading={idleReport.isLoading}
                  tone={idleCount ? "warn" : "ok"}
                  hint="sitting available — see the Idle report"
                />
              </Link>
              <Metric label="Terminated staff" value={num(k?.terminatedCount)} loading={kpis.isLoading} />
              <Metric label="Held by terminated" value={num(k?.clearanceCount)} loading={kpis.isLoading} tone={k?.clearanceCount ? "crit" : "ok"} />
            </div>
          </section>

          {/* ---- the ledger strip, at the bottom (docs/20, B2) ---- */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Latest log</h2>
              <Link href="/reports/audit-trail" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                Full audit trail <ArrowRight className="size-3.5" />
              </Link>
            </div>
            {activity.isLoading ? (
              <Skeleton className="h-48" />
            ) : !activity.data?.length ? (
              <EmptyState title="No movements recorded yet" />
            ) : (
              <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
                {activity.data.slice(0, 8).map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-3 bg-card px-4 py-2.5 text-sm">
                    <span className="label-xs w-24 shrink-0 text-foreground">
                      {String(a.eventType ?? "").replace(/_/g, " ")}
                    </span>
                    <Tag>{a.assetTag}</Tag>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {a.note ?? formatAssetModel({ make: a.assetMake, modelNumber: a.assetModelNumber, description: a.assetDescription }) ?? "Untagged tool"}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{dateTime(a.occurredAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <>
          {/* ---- command center: the widget grid, no weather ---- */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Command center</h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <SlidersHorizontal className="size-3.5" />
                    Customize
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Show widgets</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {WIDGET_DEFS.map((w) => (
                    <DropdownMenuCheckboxItem
                      key={w.id}
                      checked={visible[w.id]}
                      onCheckedChange={(v) => toggleWidget(w.id, !!v)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {w.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {/* Staggered draw-in: each widget settles a beat after the one
                  before it, so the grid reads as one arrival (docs/20, F). */}
              {[
                visible.inbox ? <InboxStatusWidget key="inbox" /> : null,
                visible.capital ? <CapitalSplitWidget key="capital" /> : null,
                visible.status ? <StatusWidget key="status" /> : null,
                visible.movements ? <MovementsWidget key="movements" /> : null,
              ].map((w, i) =>
                w ? <div key={w.key} className="animate-draw-in motion-safe" style={{ animationDelay: `${i * 80}ms` }}>{w}</div> : null,
              )}
            </div>
          </section>
        </>
      )}
      </div>
    </div>
  );
}

function AttentionCard({
  tone,
  icon: Icon,
  title,
  count,
  href,
  empty,
  children,
}: {
  tone: "crit" | "warn";
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  href: string;
  empty: string;
  children: React.ReactNode;
}) {
  const accent = tone === "crit" ? "text-crit" : "text-warn";
  const edge = tone === "crit" ? "border-t-crit" : "border-t-warn";
  return (
    <div className={`flex flex-col gap-3 rounded-md border border-t-[3px] ${edge} bg-card p-4`}>
      <div className="flex items-center gap-2">
        <Icon className={`size-4 ${accent}`} />
        <span className="text-sm font-medium">{title}</span>
        <span className={`tnum ml-auto text-2xl font-semibold ${count ? accent : "text-muted-foreground"}`}>
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">{children}</div>
          <Link href={href} className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-primary hover:underline">
            Work the queue <ArrowRight className="size-3.5" />
          </Link>
        </>
      )}
    </div>
  );
}

function Row({ left, mid, right }: { left: React.ReactNode; mid: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {left}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{mid}</span>
      <span className="shrink-0 text-xs">{right}</span>
    </div>
  );
}
