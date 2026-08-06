"use client";

import { useMemo, useState } from "react";
import { ChevronDown, EllipsisVertical, MapPin, Plus, Search, Truck, Container, HardHat, TriangleAlert, EyeOff, Eye } from "lucide-react";
import { CUSTODIAN_ROLES, formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { useJobScope } from "@/components/job-scope";
import { TableSkeleton, ErrorNote, EmptyState, Metric } from "@/components/sti/page";
import { StatusPill } from "@/components/sti/status";
import { JobsiteActivity } from "@/components/jobsite-activity";
import { CrewCard, type Crew, type Rig } from "@/components/jobsite-crew-card";
import { RigPicker, type PickerRequest } from "@/components/rig-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  Tools by Jobsite — the equipment desk's driver screen.

  The shape of the yard, in one sentence: a FOREMAN has one truck, that truck
  has at most one trailer hitched to it, and the small tools ride in the
  trailer (or the truck, or their hands). The rig belongs to the person, not
  to the job — the truck goes where they go.

  So a job with three foremen is not one card with three names crammed into it:
  it is one job card containing three CREW rows, one per foreman, each showing
  that foreman's own rig and their own tools. "The same job repeating for each
  foreman", made legible.

  Nothing here is a new concept in the API:
    crew        = (project, custodian) pair derived from asset.list
    truck       = vehicle.list where foremanEmployeeId = the foreman
    trailer     = vehicle.list where attachedToVehicleId = that truck
    hand a rig  = location.setCustodian (tools + hitched trailer follow)
    hitch       = vehicle.update { attachedToVehicleId }
*/

type ToolRow = {
  id: string;
  tag: string | null;
  serialNumber: string | null;
  make: string | null;
  modelNumber: string | null;
  description: string | null;
  categoryName: string | null;
  status: string | null;
  acquisitionCost: string | null;
  currentCustodianId?: string | null;
  custodianName?: string | null;
  currentProjectId?: string | null;
  currentLocationId?: string | null;
  locationName?: string | null;
};

const YARD = "__yard";

export default function JobsitesPage() {
  const employees = trpc.employee.list.useQuery();
  const assets = trpc.asset.list.useQuery();
  const projects = trpc.project.list.useQuery();
  const vehicles = trpc.vehicle.list.useQuery();
  const utils = trpc.useUtils();

  const { projectIds: scope } = useJobScope();

  /* ---- filters: one bar, everything searchable ---- */
  const [q, setQ] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [foremanFilter, setForemanFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [openJobs, setOpenJobs] = useState<Record<string, boolean>>({});
  const [openCrews, setOpenCrews] = useState<Record<string, boolean>>({});
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [showActivity, setShowActivity] = useState(true);

  const anyFilter = !!(q.trim() || jobFilter || foremanFilter || statusFilter || onlyGaps);
  const clearFilters = () => {
    setQ("");
    setJobFilter("");
    setForemanFilter("");
    setStatusFilter("");
    setOnlyGaps(false);
  };

  const foremen = useMemo(
    () =>
      (employees.data ?? []).filter(
        (e) =>
          e.employmentStatus === "active" &&
          CUSTODIAN_ROLES.includes(e.role as (typeof CUSTODIAN_ROLES)[number]),
      ),
    [employees.data],
  );

  /* A foreman's rig: their truck, and the trailer hitched to that truck. */
  const rigOf = useMemo(() => {
    const list = vehicles.data ?? [];
    return (foremanId: string | null | undefined): Rig => {
      if (!foremanId) return { truck: null, trailer: null };
      const truck = list.find((v) => v.vehicleType === "truck" && v.foremanEmployeeId === foremanId) ?? null;
      const trailer = truck
        ? list.find((v) => v.vehicleType === "trailer" && v.attachedToVehicleId === truck.id) ?? null
        : null;
      return { truck, trailer };
    };
  }, [vehicles.data]);

  const hit = (text: string) => !q.trim() || text.toLowerCase().includes(q.trim().toLowerCase());

  /* ---- jobs → crews → tools ---- */
  const cards = useMemo(() => {
    const tools = (assets.data ?? []) as ToolRow[];
    const out: {
      id: string;
      name: string;
      code: string | null;
      isJob: boolean;
      crews: Crew[];
      loose: ToolRow[];
      toolCount: number;
      value: number;
      gaps: string[];
    }[] = [];

    const forProject = (projectId: string | null) =>
      tools.filter((t) => (projectId ? t.currentProjectId === projectId : !t.currentProjectId));

    const buildCrews = (projectId: string, jobHit: boolean) => {
      const rows = forProject(projectId);
      const byForeman = new Map<string, ToolRow[]>();
      for (const t of rows) {
        if (!t.currentCustodianId) continue;
        const arr = byForeman.get(t.currentCustodianId) ?? [];
        arr.push(t);
        byForeman.set(t.currentCustodianId, arr);
      }
      const crews: Crew[] = [];
      byForeman.forEach((crewTools, foremanId) => {
        if (foremanFilter && foremanId !== foremanFilter) return;
        const person = foremen.find((f) => f.id === foremanId);
        const rig = rigOf(foremanId);
        const rigText = `${person?.name ?? ""} ${rig.truck?.unit ?? ""} ${rig.truck?.makeModel ?? ""} ${rig.trailer?.unit ?? ""}`;
        const visible = crewTools.filter(
          (t) =>
            (jobHit || hit(`${t.tag ?? ""} ${t.serialNumber ?? ""} ${formatAssetModel(t)} ${rigText}`)) &&
            (!statusFilter || t.status === statusFilter),
        );
        crews.push({
          id: `${projectId}:${foremanId}`,
          foremanId,
          foremanName: person?.name ?? "Unknown",
          foremanRole: person?.role ?? "",
          rig,
          tools: visible,
          /* One foreman, several jobs: the same rig shows on each of their cards. */
          otherJobs: new Set(
            tools.filter((t) => t.currentCustodianId === foremanId && t.currentProjectId && t.currentProjectId !== projectId).map((t) => t.currentProjectId),
          ).size,
        });
      });
      return crews.sort((a, b) => a.foremanName.localeCompare(b.foremanName));
    };

    for (const p of projects.data ?? []) {
      if (scope && !scope.has(p.id)) continue;
      if (jobFilter && jobFilter !== p.id) continue;
      const jobHit = hit(`${p.name} ${p.externalId ?? ""}`);
      const crews = buildCrews(p.id, jobHit);
      const loose = forProject(p.id).filter(
        (t) =>
          !t.currentCustodianId &&
          !foremanFilter &&
          (jobHit || hit(`${t.tag ?? ""} ${t.serialNumber ?? ""} ${formatAssetModel(t)}`)) &&
          (!statusFilter || t.status === statusFilter),
      );
      const toolCount = crews.reduce((n, c) => n + c.tools.length, 0) + loose.length;
      const value =
        crews.reduce((n, c) => n + c.tools.reduce((m, t) => m + (Number(t.acquisitionCost) || 0), 0), 0) +
        loose.reduce((n, t) => n + (Number(t.acquisitionCost) || 0), 0);
      const noTruck = crews.filter((c) => !c.rig.truck).length;
      const gaps = crews.length === 0 ? ["no crew"] : noTruck ? [`${noTruck} crew${noTruck === 1 ? "" : "s"} without a truck`] : [];
      out.push({ id: p.id, name: p.name, code: p.externalId, isJob: true, crews, loose, toolCount, value, gaps });
    }

    if (!scope && (!jobFilter || jobFilter === YARD) && !foremanFilter) {
      const yardTools = forProject(null).filter(
        (t) => hit(`${t.tag ?? ""} ${t.serialNumber ?? ""} ${formatAssetModel(t)} yard`) && (!statusFilter || t.status === statusFilter),
      );
      out.push({
        id: YARD,
        name: "Equipment Yard",
        code: "URB-YARD",
        isJob: false,
        crews: [],
        loose: yardTools,
        toolCount: yardTools.length,
        value: yardTools.reduce((n, t) => n + (Number(t.acquisitionCost) || 0), 0),
        gaps: [],
      });
    }

    return out.filter((c) => {
      if (onlyGaps && !c.gaps.length) return false;
      /* A card filtered down to nothing is noise, not information. */
      if (anyFilter && c.toolCount === 0 && c.crews.length === 0) return false;
      return true;
    });
  }, [assets.data, projects.data, foremen, rigOf, scope, q, jobFilter, foremanFilter, statusFilter, onlyGaps, anyFilter]);

  const shownTools = cards.reduce((n, c) => n + c.toolCount, 0);
  const shownCrews = cards.reduce((n, c) => n + c.crews.length, 0);
  const crewsWithoutTruck = cards.reduce((n, c) => n + c.crews.filter((x) => !x.rig.truck).length, 0);

  const invalidate = () => {
    utils.vehicle.list.invalidate();
    utils.asset.list.invalidate();
  };

  if (assets.isLoading || projects.isLoading || vehicles.isLoading) return <TableSkeleton cols={4} />;
  if (assets.isError || projects.isError) return <ErrorNote message="The jobsite view could not be loaded." />;

  return (
    <div className="flex flex-col gap-4">
      <RigPicker request={picker} onClose={() => setPicker(null)} onDone={invalidate} foremen={foremen} vehicles={vehicles.data ?? []} projects={projects.data ?? []} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Crews on jobs" value={shownCrews} hint="one foreman and their rig, per job" />
        <Metric label="Tools out" value={shownTools} hint={`across ${cards.length} cards`} />
        <Metric label="Fleet value out" value={money(cards.reduce((n, c) => n + c.value, 0))} hint="acquisition cost" />
        <Metric label="Crews without a truck" value={crewsWithoutTruck} tone={crewsWithoutTruck ? "warn" : "ok"} hint="cannot haul their tools" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          {/* ---- one filter bar: search hits every noun in the list ---- */}
          <section className="flex flex-col gap-2 rounded-md border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-56 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search everything — job, foreman, truck, trailer, serial or tool…"
                  className="pl-8"
                  aria-label="Search the jobsite list"
                />
              </div>
              <Select value={jobFilter} onChange={setJobFilter} label="All jobs">
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.externalId ? `${p.externalId} · ${p.name}` : p.name}</option>
                ))}
                <option value={YARD}>URB-YARD · Equipment Yard</option>
              </Select>
              <Select value={foremanFilter} onChange={setForemanFilter} label="All foremen">
                {foremen.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
              <Select value={statusFilter} onChange={setStatusFilter} label="Any status">
                <option value="assigned">Assigned</option>
                <option value="available">Available</option>
                <option value="in_maintenance">In maintenance</option>
                <option value="lost">Lost</option>
              </Select>
              <Button variant={onlyGaps ? "secondary" : "outline"} size="sm" onClick={() => setOnlyGaps((v) => !v)}>
                <TriangleAlert className="size-3.5" /> Needs a rig
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="tnum">
                {shownTools} tool{shownTools === 1 ? "" : "s"} · {shownCrews} crew{shownCrews === 1 ? "" : "s"} · {cards.length} card{cards.length === 1 ? "" : "s"}
              </span>
              {anyFilter ? (
                <Button variant="ghost" size="sm" className="h-6 rounded-full px-2 text-primary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                {!showActivity ? (
                  <Button variant="outline" size="sm" onClick={() => setShowActivity(true)}>
                    <Eye className="size-3.5" /> Show activity
                  </Button>
                ) : null}
              </div>
            </div>
          </section>

          {!cards.length ? (
            <EmptyState icon={MapPin} title="Nothing matches those filters" description="Clear a filter, or search for a different unit." />
          ) : null}

          {cards.map((card) => {
            const open = openJobs[card.id] ?? true;
            return (
              <section key={card.id} className="overflow-visible rounded-md border bg-card">
                <header className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", card.isJob ? "bg-accent text-primary" : "bg-muted text-muted-foreground")}>
                    <MapPin className="size-4.5" aria-hidden />
                  </span>
                  <span className="flex min-w-40 flex-1 flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">{card.name}</span>
                    {card.code ? <span className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{card.code}</span> : null}
                    <span className="text-sm text-muted-foreground">
                      {card.isJob ? (card.crews.length ? `${card.crews.length} crew${card.crews.length === 1 ? "" : "s"}` : "no crew yet") : "between jobs"}
                    </span>
                    {card.gaps.length ? (
                      <span className="flex items-center gap-1.5 rounded-full bg-warn-bg px-2 py-0.5 text-xs font-medium text-warn">
                        <TriangleAlert className="size-3" aria-hidden /> {card.gaps.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-right whitespace-nowrap">
                      <span className="block rounded-md border bg-muted/50 px-2 py-0.5 text-xs">
                        <span className="tnum font-semibold text-foreground">{card.toolCount}</span> tool{card.toolCount === 1 ? "" : "s"}
                      </span>
                      <span className="tnum mt-0.5 block text-[11px] text-muted-foreground">{money(card.value)}</span>
                    </span>
                    {card.isJob ? (
                      <Button variant="outline" size="sm" className="border-dashed text-primary" onClick={() => setPicker({ kind: "crew", projectId: card.id })}>
                        <Plus className="size-3.5" /> Add crew
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="size-8" aria-label="Jobsite actions">
                          <EllipsisVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {card.isJob ? (
                          <DropdownMenuItem onSelect={() => setPicker({ kind: "crew", projectId: card.id })}>Add a foreman and rig</DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onSelect={() => setOpenJobs((o) => ({ ...o, [card.id]: !open }))}>
                          {open ? "Collapse" : "Expand"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button variant="outline" size="icon" className="size-8" aria-label="Expand" onClick={() => setOpenJobs((o) => ({ ...o, [card.id]: !open }))}>
                      <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                    </Button>
                  </span>
                </header>

                {open ? (
                  <div className="flex flex-col gap-2.5 border-t bg-muted/25 p-3">
                    {card.crews.map((crew) => (
                      <CrewCard
                        key={crew.id}
                        crew={crew}
                        expanded={openCrews[crew.id] ?? false}
                        onToggle={() => setOpenCrews((o) => ({ ...o, [crew.id]: !(o[crew.id] ?? false) }))}
                        onPick={setPicker}
                        projectId={card.id}
                      />
                    ))}

                    {card.isJob && !card.crews.length ? (
                      <button
                        type="button"
                        onClick={() => setPicker({ kind: "crew", projectId: card.id })}
                        className="rounded-md border border-dashed bg-card p-4 text-left text-sm font-medium text-primary"
                      >
                        No crew on this job yet — add a foreman and their rig.
                      </button>
                    ) : null}

                    {card.loose.length ? (
                      <div className="overflow-hidden rounded-md border bg-card">
                        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold">
                          <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
                          {card.isJob ? "On site, nobody holding" : "Waiting in the yard"}
                          <span className="tnum font-normal text-muted-foreground">{card.loose.length}</span>
                        </div>
                        <ToolTable rows={card.loose} showWhere />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>

        {showActivity ? (
          <aside className="h-fit lg:sticky lg:top-4">
            <div className="relative">
              <Button
                variant="outline"
                size="icon"
                className="absolute right-2 top-2 z-10 size-7"
                aria-label="Hide activity panel"
                onClick={() => setShowActivity(false)}
              >
                <EyeOff className="size-3.5" />
              </Button>
              <JobsiteActivity projectOptions={(projects.data ?? []).map((p) => ({ id: p.id, name: p.name }))} />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/* Serial / ID · Tool name · Status · Value. No "rides on" column: the row
   already sits under the rig it rides in. */
export function ToolTable({ rows, showWhere }: { rows: ToolRow[]; showWhere?: boolean }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b bg-muted/40">
          <th className="label-xs w-32 px-3 py-1.5 text-left">Serial / ID</th>
          <th className="label-xs px-3 py-1.5 text-left">Tool name</th>
          <th className="label-xs w-36 px-3 py-1.5 text-left">Status</th>
          <th className="label-xs w-24 px-3 py-1.5 text-right">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
            <td className="px-3 py-2 font-mono text-[13px] text-muted-foreground">{t.tag ?? t.serialNumber ?? "Untagged"}</td>
            <td className="px-3 py-2">
              <span className="font-medium">{formatAssetModel(t) || "No description"}</span>
              {showWhere && t.locationName ? <span className="block text-xs text-muted-foreground">{t.locationName}</span> : null}
            </td>
            <td className="px-3 py-2"><StatusPill status={t.status} /></td>
            <td className="tnum px-3 py-2 text-right text-muted-foreground">{money(t.acquisitionCost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Select({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={cn(
        "h-8 max-w-44 rounded-md border border-input bg-transparent px-2 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        value && "border-primary/40 bg-accent text-accent-foreground",
      )}
    >
      <option value="">{label}</option>
      {children}
    </select>
  );
}
