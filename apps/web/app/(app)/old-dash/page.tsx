"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BookmarkCheck,
  CalendarClock,
  CheckCircle2,
  Handshake,
  Hourglass,
  PackageCheck,
  ScanBarcode,
  SearchX,
  SlidersHorizontal,
  Star,
  UserMinus,
  Wrench,
} from "lucide-react";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { isFieldRole } from "@/components/sti/nav-config";
import { Metric, EmptyState } from "@/components/sti/page";
import { Tag } from "@/components/sti/status";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dateTime, num, relative } from "@/lib/format";
import { FleetLegend } from "@/components/fleet-map-view";
import { GreetingBar } from "@/components/greeting-bar";
import { MovementChart } from "@/components/movement-chart";
import { useThemeStore } from "@/lib/themes/store";
import { DEFAULT_PREFS } from "@/lib/themes/themes";
import {
  InboxStatusWidget,
  MovementsWidget,
  StatusWidget,
  WIDGET_DEFS,
  widgetVisibility,
  type WidgetId,
} from "@/components/dashboard-widgets";
import { cn } from "@/lib/utils";
import { BlockyDashboardView } from "@/components/sti/dashboard/blocky-dashboard-view";

/*
  The previous desk dashboard (docs/20, B) — kept, unchanged, at /old-dash.

  The project monitor took over /home on 2026-08-23. This page is not
  deprecated-by-comment and then left to rot: it is the fallback while the
  monitor is being lived with, it is still in the Overview group as "Old Dash",
  and every query behind it is one the monitor does not make. Delete it when
  nobody opens it, not before.

  Two tabs instead of one wall:
  - Fleet at a Glance — greeting+weather bar, the work queue beside the fleet
    map, the metrics, and the ledger strip at the bottom.
  - Command Center — the widget grid (inbox status, fleet shape,
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

/* `blocky` is the System Shell v3 concept dashboard (concept/blocky-shell-v3),
   wired to the same scoped data as the other two tabs so the desk can compare
   renderings of the same numbers. It is a concept tab, not a shipped default —
   deliberately kept OUT of `DefaultTab`, so the persisted preference can never
   name it and a star-click on the concept view cannot overwrite a real default. */
type DefaultTab = "fleet" | "command";
type Tab = DefaultTab | "blocky";

export default function OldDashPage() {
  const router = useRouter();
  const { role, has } = usePermissions();
  /*
    STI-302/304: this dashboard is entirely asset-shaped, and since the reads
    behind it require `asset.read` a role that lacks it (HR) landed on a page of
    empty tiles, an empty ledger strip and a "Full audit trail" link that 403s.
    STI-304 AC 4 is explicit that a role logging in to an empty dashboard is not
    delivered. The asset sections are gated on the same permission their queries
    need, so the page shows what this account can actually use instead of the
    shape of what it cannot.
  */
  const seesTools = has("asset.read");

  /* Field roles get their own landing surface. */
  useEffect(() => {
    if (isFieldRole(role)) router.replace("/my-tools");
  }, [role, router]);

  /* `enabled` rather than just hiding the panels: a hidden panel whose query
     still runs fills the console with 403s on every load for HR, which is how
     a real error stops being visible among the expected ones. The gate and the
     fetch answer to the same permission. */
  const kpis = trpc.dashboard.kpis.useQuery(undefined, { enabled: seesTools });
  const approvals = trpc.dashboard.pendingApprovals.useQuery(undefined, { enabled: seesTools });
  const activity = trpc.dashboard.recentActivity.useQuery(undefined, { enabled: seesTools });
  const idleReport = trpc.report.idle.useQuery(undefined, { enabled: seesTools });
  const me = trpc.identity.me.useQuery();

  const prefs = useThemeStore((s) => s.prefs);
  const setPrefs = useThemeStore((s) => s.setPrefs);
  const utils = trpc.useUtils();

  const defaultTab: DefaultTab = prefs?.dashboard.defaultTab ?? "fleet";
  const [tab, setTab] = useState<Tab>("fleet");
  const touched = useRef(false);
  /* Hydrate the tab from the stored default once — but never stamp over a tab
     the user has already switched to. */
  useEffect(() => {
    if (!touched.current && prefs?.dashboard.defaultTab) setTab(prefs.dashboard.defaultTab);
  }, [prefs]);

  const setDefaultTab = (t: DefaultTab) => {
    /* DEFAULT_PREFS, not a locally duplicated literal — this write path used
       to hardcode "drafting-ink" here, so a star-click or widget toggle that
       landed before the prefs query resolved would silently persist that
       theme over whatever the user had actually chosen. One shared default
       means this can't drift from the app's real default again. */
    const base = prefs ?? DEFAULT_PREFS;
    const next = { ...base, dashboard: { ...base.dashboard, defaultTab: t } };
    setPrefs(next);
    utils.client.preferences.set.mutate(next);
  };

  const visible = widgetVisibility(prefs);
  const toggleWidget = (id: WidgetId, on: boolean) => {
    const base = prefs ?? DEFAULT_PREFS; /* see setDefaultTab above */
    const next = { ...base, dashboard: { ...base.dashboard, widgets: { ...visible, [id]: on } } };
    setPrefs(next);
    utils.client.preferences.set.mutate(next);
  };

  const k = kpis.data;

  /* Everything pendingApprovals returns is pending_approval — the verify flow
     (and its "Loans to verify" card) was removed on 2026-08-09; the desk is
     the only writer of movements now. */
  const holds = approvals.data ?? [];

  const attention = holds.length;

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
        <Tabs value={tab} onValueChange={(v) => { touched.current = true; setTab(v as Tab); }}>
          <TabsList variant="default">
            <TabsTrigger value="fleet">Fleet at a Glance</TabsTrigger>
            <TabsTrigger value="command">Command Center</TabsTrigger>
            <TabsTrigger value="blocky">Blocky</TabsTrigger>
          </TabsList>
        </Tabs>
        {/* The star, per tab: whichever view is starred opens first. The
            concept tab is not a valid default, so starring it is a no-op. */}
        <button
          type="button"
          onClick={() => { touched.current = true; if (tab !== "blocky") setDefaultTab(tab); }}
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

              {approvals.isLoading ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}
                </div>
              ) : attention === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Nothing is waiting"
                  description="Nothing is waiting for approval. The yard is square."
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* The "HR clearance" card stood beside Awaiting approval until
                      2026-08-27, listing tools still on a terminated person's name
                      and offering departure reassignment. Removed with the rest of
                      the offboarding gate — Urban does not want one. */}
                  <AttentionCard
                    tone="warn"
                    icon={AlertTriangle}
                    title="Awaiting approval"
                    count={holds.length}
                    href="/custody?tab=queue"
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
          {seesTools ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Fleet at a glance</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric icon={PackageCheck} label="Available" value={num(k?.available)} loading={kpis.isLoading} hint="ready to issue" />
              <Metric icon={Handshake} label="Assigned" value={num(k?.assigned)} loading={kpis.isLoading} hint="out with a custodian" />
              <Metric icon={Wrench} label="In maintenance" value={num(k?.inMaintenance)} loading={kpis.isLoading} tone={k?.inMaintenance ? "warn" : "default"} />
              <Metric icon={SearchX} label="Lost" value={num(k?.lost)} loading={kpis.isLoading} tone={k?.lost ? "crit" : "ok"} hint="unaccounted for" />
              {/* Fleet value, capital on jobs and shop capital used to sit here.
                  All three were sums of acquisition cost, which is not a number
                  the desk acts on: nobody issues, chases or writes off a tool
                  because of what the register totals. They remain as reports —
                  capital by project, by department, and the split chart — which
                  is where a financial question gets answered. This row is for
                  the operational ones. */}
              <Metric icon={BookmarkCheck} label="Reserved" value={num(k?.reserved)} loading={kpis.isLoading} />
              <Metric
                icon={CalendarClock}
                label="Scheduled maintenance"
                value={num(k?.scheduledMaint)}
                loading={kpis.isLoading}
                hint="maintenance module not built yet"
              />
              <Metric
                icon={ScanBarcode}
                label="Missing serials"
                value={num(k?.missingSerial)}
                loading={kpis.isLoading}
                tone={k?.missingSerial ? "warn" : "ok"}
                hint="serialized tools that cannot be identified if stolen"
              />
              <Link href="/reports/idle" className="block transition-opacity hover:opacity-80">
                <Metric
                  icon={Hourglass}
                  label="Idle tools"
                  value={num(idleCount)}
                  loading={idleReport.isLoading}
                  tone={idleCount ? "warn" : "ok"}
                  hint="sitting available — see the Idle report"
                />
              </Link>
              <Metric icon={UserMinus} label="Terminated staff" value={num(k?.terminatedCount)} loading={kpis.isLoading} />
            </div>
          </section>
          ) : (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">Fleet at a glance</h2>
              <EmptyState
                title="This account does not track tools"
                description="Your role covers people and records rather than the equipment register. Use People and Reports & Logs in the sidebar."
              />
            </section>
          )}

          {/* ---- the movement chart (dashboard-01 slot), above the ledger ---- */}
          {seesTools ? (
          <section className="flex flex-col gap-3">
            <MovementChart />
          </section>
          ) : null}

          {/* ---- the ledger strip, at the bottom (docs/20, B2) ---- */}
          {seesTools ? (
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
          ) : null}
        </>
      ) : tab === "command" ? (
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
                visible.status ? <StatusWidget key="status" /> : null,
                visible.movements ? <MovementsWidget key="movements" /> : null,
              ].map((w, i) =>
                w ? <div key={w.key} className="animate-draw-in motion-safe" style={{ animationDelay: `${i * 80}ms` }}>{w}</div> : null,
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          {/* ---- blocky: the System Shell v3 concept dashboard ---- */}
          <BlockyDashboardView />
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
