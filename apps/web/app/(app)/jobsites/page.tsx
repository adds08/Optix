"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Boxes, ChevronDown, HardHat, MapPin, Search } from "lucide-react";
import { CUSTODIAN_ROLES, formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, Metric } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { FilterPills } from "@/components/sti/facets";
import { ToolIcon } from "@/components/sti/tool-icon";
import { SavedFilters } from "@/components/saved-filters";
import { JobsiteActivity } from "@/components/jobsite-activity";
import { Input } from "@/components/ui/input";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  The register, grouped by job site — one card per project, expanded to see
  the tools working there.

  Urban treats the project as the job site (there is no separate "location":
  the project carries it), so "what is on Legacy West?" is answered by opening
  this page and finding the Legacy West card. A "Not on a job" card catches
  the tools sitting in the yard between jobs.

  The page reads top-down: numbers first (how many sites, how many tools, how
  much value), then the sites themselves with their foremen, top categories and
  status mix at a glance, and a live activity panel pinned to the right that
  shows the ledger as it happens — scoped to one site with the dropdown in its
  header.
*/

const STATUSES = ["available", "assigned", "in_maintenance", "reserved", "lost"] as const;

type JobsiteFilters = {
  foreman: string; // "" = all
  category: string; // "" = all
  status: string; // "" = all
  q: string;
};

const EMPTY: JobsiteFilters = { foreman: "", category: "", status: "", q: "" };

/* The fields of an asset row this view reads. The API returns more; typing the
   slice keeps the grouping and the filters honest about what they use. */
type Tool = {
  id: string;
  tag: string | null;
  make: string | null;
  modelNumber: string | null;
  description: string | null;
  serialNumber: string | null;
  categoryName: string | null;
  status: string | null;
  acquisitionCost: string | null;
  custodianId?: string | null;
  custodianName?: string | null;
  locationName?: string | null;
  currentProjectId?: string | null;
};

type Group = {
  id: string;
  name: string;
  externalId: string | null;
  tools: Tool[];
  foremen: string[];
  value: number;
  categories: { name: string; count: number }[];
  statusCounts: Record<string, number>;
};

function matchesText(
  r: { tag: string | null; make: string | null; modelNumber: string | null; description: string | null; serialNumber: string | null },
  q: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [r.tag, r.make, r.modelNumber, r.description, r.serialNumber].some((v) =>
    v?.toLowerCase().includes(needle),
  );
}

const STATUS_TONE: Record<string, string> = {
  available: "bg-ok/70",
  assigned: "bg-primary/70",
  in_maintenance: "bg-warn/70",
  lost: "bg-crit/70",
};

export default function JobsitesPage() {
  const [filters, setFilters] = useState<JobsiteFilters>(EMPTY);

  const employees = trpc.employee.list.useQuery();
  const assets = trpc.asset.list.useQuery();
  const projects = trpc.project.list.useQuery();

  const foremanOptions = useMemo(
    () =>
      (employees.data ?? []).filter(
        (e) =>
          e.employmentStatus === "active" &&
          CUSTODIAN_ROLES.includes(e.role as (typeof CUSTODIAN_ROLES)[number]),
      ),
    [employees.data],
  );

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets.data ?? []) if (a.categoryName) set.add(a.categoryName);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [assets.data]);

  const match = (a: Tool) => {
    if (filters.foreman && a.custodianId !== filters.foreman) return false;
    if (filters.category && (a.categoryName ?? "") !== filters.category) return false;
    if (filters.status && a.status !== filters.status) return false;
    if (filters.q && !matchesText(a, filters.q)) return false;
    return true;
  };

  /* One group per project (plus the yard), each with the tools that pass the
     filters, and the numbers a card needs to read at a glance. */
  const groups = useMemo(() => {
    const byId = new Map<string, Group>();
    for (const p of projects.data ?? []) {
      byId.set(p.id, {
        id: p.id,
        name: p.name,
        externalId: p.externalId ?? null,
        tools: [],
        foremen: [],
        value: 0,
        categories: [],
        statusCounts: {},
      });
    }
    const yard: Group = {
      id: "__yard",
      name: "Not on a job",
      externalId: null,
      tools: [],
      foremen: [],
      value: 0,
      categories: [],
      statusCounts: {},
    };
    for (const a of assets.data ?? []) {
      if (!match(a)) continue;
      const g = a.currentProjectId && byId.has(a.currentProjectId) ? byId.get(a.currentProjectId)! : yard;
      g.tools.push(a);
    }
    const cards = [...byId.values()].filter((g) => g.tools.length > 0).sort((a, b) => a.name.localeCompare(b.name));
    if (yard.tools.length) cards.push(yard);

    for (const g of cards) {
      g.tools.sort((a, b) => (a.tag ?? "").localeCompare(b.tag ?? ""));
      g.foremen = [...new Set(g.tools.map((t) => t.custodianName).filter((n): n is string => !!n))].sort();
      g.value = g.tools.reduce((n, t) => n + (Number(t.acquisitionCost) || 0), 0);
      g.statusCounts = {};
      for (const t of g.tools) {
        const s = t.status ?? "unknown";
        g.statusCounts[s] = (g.statusCounts[s] ?? 0) + 1;
      }
      const catCount = new Map<string, number>();
      for (const t of g.tools) {
        if (t.categoryName) catCount.set(t.categoryName, (catCount.get(t.categoryName) ?? 0) + 1);
      }
      g.categories = [...catCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => ({ name, count }));
    }
    return cards;
  }, [assets.data, projects.data, filters.foreman, filters.category, filters.status, filters.q]);

  const totalTools = groups.reduce((n, g) => n + g.tools.length, 0);
  const totalValue = groups.reduce((n, g) => n + g.value, 0);
  const yardTools = groups.find((g) => g.id === "__yard")?.tools.length ?? 0;

  const hasActive =
    filters.foreman !== "" || filters.category !== "" || filters.status !== "" || filters.q.trim() !== "";

  const clearAll = () => setFilters(EMPTY);

  const applySaved = (f: Record<string, unknown>) => {
    setFilters({
      foreman: typeof f.foreman === "string" ? f.foreman : "",
      category: typeof f.category === "string" ? f.category : "",
      status: typeof f.status === "string" ? f.status : "",
      q: typeof f.q === "string" ? f.q : "",
    });
  };

  const pills = [
    ...(filters.foreman
      ? [{ key: "foreman", label: (foremanOptions.find((e) => e.id === filters.foreman)?.name ?? "Foreman"), onRemove: () => setFilters((f) => ({ ...f, foreman: "" })) }]
      : []),
    ...(filters.category ? [{ key: "cat", label: filters.category, onRemove: () => setFilters((f) => ({ ...f, category: "" })) }] : []),
    ...(filters.status ? [{ key: "st", label: humanize(filters.status), onRemove: () => setFilters((f) => ({ ...f, status: "" })) }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Equipment"
        title="Tools by Jobsite"
        description="One card per job site — who is there, what is working it, and what just moved."
      />

      {assets.isLoading || projects.isLoading ? (
        <TableSkeleton cols={4} />
      ) : assets.isError || projects.isError ? (
        <ErrorNote message="The jobsite view could not be loaded. Check that the API is running, then reload." />
      ) : (
        <>
          {/* The numbers that make the page worth opening. */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Job sites with tools" value={groups.length} hint="projects holding anything" />
            <Metric label="Tools on site" value={totalTools} hint={`across ${groups.length} sites`} />
            <Metric label="Fleet value on site" value={money(totalValue)} hint="acquisition cost" />
            <Metric
              label="Not on a job"
              value={yardTools}
              tone={yardTools ? "warn" : "ok"}
              hint="sitting in the yard between jobs"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* Main column: filters + the site cards. */}
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] max-w-sm flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={filters.q}
                    onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                    placeholder="Search tag, model or serial…"
                    className="pl-8"
                    aria-label="Search tools"
                  />
                </div>
                <select
                  value={filters.foreman}
                  onChange={(e) => setFilters((f) => ({ ...f, foreman: e.target.value }))}
                  aria-label="Filter by foreman"
                  className="flex h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">All foremen</option>
                  {foremanOptions.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
                <select
                  value={filters.category}
                  onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
                  aria-label="Filter by category"
                  className="flex h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">All categories</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                  aria-label="Filter by status"
                  className="flex h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{humanize(s)}</option>
                  ))}
                </select>
                <SavedFilters
                  storageKey="jobsites"
                  current={filters}
                  onApply={applySaved}
                  hasActive={hasActive}
                  onClear={clearAll}
                />
              </div>

              <FilterPills pills={pills} />

              {!groups.length ? (
                <EmptyState
                  icon={Boxes}
                  title="No tools match"
                  description="Try a different search, or clear a filter."
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {groups.map((g) => (
                    <details
                      key={g.id}
                      className="group overflow-hidden rounded-md border bg-card transition-colors open:border-foreground/25"
                    >
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                            <MapPin className="size-5" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-semibold">{g.name}</span>
                              {g.externalId ? (
                                <Tag className="bg-muted/60">{g.externalId}</Tag>
                              ) : null}
                            </span>
                            {g.foremen.length ? (
                              <span className="mt-1 flex flex-wrap gap-1.5">
                                {g.foremen.slice(0, 4).map((n) => (
                                  <span
                                    key={n}
                                    className="flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-xs text-muted-foreground"
                                  >
                                    <HardHat className="size-3 text-muted-foreground/70" aria-hidden />
                                    {n}
                                  </span>
                                ))}
                                {g.foremen.length > 4 ? (
                                  <span className="text-xs text-muted-foreground/70">
                                    +{g.foremen.length - 4}
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">nobody holding tools</span>
                            )}
                          </span>
                        </span>

                        {/* Top categories at a glance — an icon row, not a wall of
                            text. */}
                        {g.categories.length ? (
                          <span className="hidden gap-1.5 md:flex">
                            {g.categories.map((c) => (
                              <span
                                key={c.name}
                                title={c.name}
                                className="flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground"
                              >
                                <ToolIcon category={c.name} className="size-3.5" />
                                {c.count}
                              </span>
                            ))}
                          </span>
                        ) : null}

                        <span className="ml-auto flex items-center gap-3">
                          {/* Status mix as quiet dots with counts. */}
                          <span className="hidden items-center gap-2 sm:flex">
                            {Object.entries(g.statusCounts)
                              .filter(([s]) => s in STATUS_TONE)
                              .slice(0, 4)
                              .map(([s, n]) => (
                                <span
                                  key={s}
                                  title={humanize(s)}
                                  className="flex items-center gap-1 text-[11px] text-muted-foreground"
                                >
                                  <span className={cn("size-1.5 rounded-full", STATUS_TONE[s])} />
                                  <span className="tnum">{n}</span>
                                </span>
                              ))}
                          </span>
                          <span className="flex flex-col items-end">
                            <span className="rounded-md border bg-muted/50 px-2 py-0.5 text-xs">
                              <span className="tnum font-semibold text-foreground">{g.tools.length}</span>{" "}
                              tool{g.tools.length === 1 ? "" : "s"}
                            </span>
                            {g.value > 0 ? (
                              <span className="mt-0.5 tnum text-[11px] text-muted-foreground">
                                {money(g.value)}
                              </span>
                            ) : null}
                          </span>
                          <ChevronDown
                            className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                            aria-hidden
                          />
                        </span>
                      </summary>

                      <div className="border-t">
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                {["Tag", "Tool", "Status", "Holder", "Where", "Value"].map((h, i) => (
                                  <th key={h} className={`label-xs px-4 py-2 ${i >= 4 ? "text-right" : "text-left"}`}>
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {g.tools.map((a) => (
                                <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40">
                                  <td className="px-4 py-2">
                                    <Link href={`/tools/${a.id}`} className="hover:underline">
                                      <Tag>{a.tag ?? "Untagged"}</Tag>
                                    </Link>
                                  </td>
                                  <td className="px-4 py-2">
                                    <Link
                                      href={`/tools/${a.id}`}
                                      className="flex items-center gap-2 font-medium hover:underline"
                                    >
                                      <ToolIcon
                                        category={a.categoryName}
                                        className="size-4 shrink-0 text-muted-foreground"
                                      />
                                      <span>{formatAssetModel(a) || "No description"}</span>
                                    </Link>
                                  </td>
                                  <td className="px-4 py-2">
                                    <StatusPill status={a.status} />
                                  </td>
                                  <td className="px-4 py-2">{a.custodianName ?? "In the yard"}</td>
                                  <td className="px-4 py-2 text-muted-foreground">
                                    {a.locationName ?? "—"}
                                  </td>
                                  <td className="px-4 py-2 text-right tnum text-muted-foreground">
                                    {money(a.acquisitionCost)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>

            {/* Right rail: the live feed, pinned while the list scrolls. */}
            <aside className="lg:sticky lg:top-4 h-fit">
              <JobsiteActivity
                projectOptions={(projects.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
