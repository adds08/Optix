"use client";

import { useMemo, useState } from "react";
import { Building2, ChevronDown, EllipsisVertical, Package, PackageOpen, Plus, Search, TriangleAlert, Users, Warehouse, Eye } from "lucide-react";
import { CUSTODIAN_ROLES, formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { useJobScope } from "@/components/job-scope";
import { usePermissions } from "@/components/use-permissions";
import { TableSkeleton, ErrorNote, EmptyState, Metric } from "@/components/sti/page";
import { JobsiteActivity } from "@/components/jobsite-activity";
import { CrewCard, type Crew } from "@/components/jobsite-crew-card";
import { RigPicker, type PickerRequest } from "@/components/rig-picker";
import { CrewAssignDialog, type CrewAssignRequest } from "@/components/crew-assign-dialog";
import { ToolTable, type ToolRow } from "@/components/jobsite-tool-table";
import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SearchSelect } from "@/components/ui/search-select";
import { humanize } from "@/components/sti/status";
import { rigOf } from "@/lib/rig";
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
    move a crew = projectTeam.assign (the same move employee.assignToProject
                  makes: posting, primary project, roster, truck, hitched
                  trailer and the tools aboard all follow)
*/

const YARD = "__yard";
const NOJOB = "__nojob";

/* Every header gets its own subtle color so the page reads as sections, not a
   wall of identical strips: jobs are primary-tinted, the yard muted, and the
   project-less people accent-tinted. */
const CARD_TINT: Record<string, string> = {
  [YARD]: "bg-muted/30",
  [NOJOB]: "bg-accent/30",
};

export default function JobsitesPage() {
  const employees = trpc.employee.list.useQuery();
  const assets = trpc.asset.list.useQuery();
  const projects = trpc.project.list.useQuery();
  const vehicles = trpc.vehicle.list.useQuery();
  const utils = trpc.useUtils();
  const { has } = usePermissions();

  /* What this viewer may actually drive. The picker actions are each backed
     by a server permission — a foreman browsing the yard must not see buttons
     that can only fail, nor the tenant-wide vehicle list behind them. */
  const canAssignCrew = has("project.assign.foreman");
  const canManageRig = has("vehicle.manage") || has("location.manage");
  const canDrive = canAssignCrew || canManageRig;
  /* Handing a loose tool to a foreman is assignment.create — held by more
     people than the rig controls, so it gates the loose-tool selection. */
  const canAssignTools = has("assignment.create");
  /* The per-tool ⋯ menu (return / hand over / status) needs any of the custody
     or manage permissions to be worth showing. */
  const canActTools = has("assignment.create") || has("transfer.create") || has("asset.manage");

  const { projectIds: scope } = useJobScope();

  /* ---- filters: one bar, everything searchable ---- */
  const [q, setQ] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [foremanFilter, setForemanFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [openJobs, setOpenJobs] = useState<Record<string, boolean>>({});
  const [openCrews, setOpenCrews] = useState<Record<string, boolean>>({});
  /* Everything is expanded by default; this flips the default for cards AND
     crew tool tables at once, and per-item toggles still override it. */
  const [collapseAll, setCollapseAll] = useState(false);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [assign, setAssign] = useState<CrewAssignRequest | null>(null);
  /* Loose tools ticked on a card's "nobody holding" section, per card. */
  const [selectedLoose, setSelectedLoose] = useState<Record<string, Set<string>>>({});
  const [showActivity, setShowActivity] = useState(true);

  const anyFilter = !!(q.trim() || jobFilter || foremanFilter || statusFilter || onlyGaps);
  const clearFilters = () => {
    setQ("");
    setJobFilter("");
    setForemanFilter("");
    setStatusFilter("");
    setOnlyGaps(false);
  };

  /* The foreman picker wants active custodians; crew DISPLAY must resolve any
     holder — including terminated staff, who are exactly the people whose
     crews the HR-clearance workflow cares about. */
  const foremen = useMemo(
    () =>
      (employees.data ?? []).filter(
        (e) =>
          e.employmentStatus === "active" &&
          CUSTODIAN_ROLES.includes(e.role as (typeof CUSTODIAN_ROLES)[number]),
      ),
    [employees.data],
  );
  const allCustodians = employees.data ?? [];

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
      tint: string;
    }[] = [];

    const forProject = (projectId: string | null) =>
      tools.filter((t) => (projectId ? t.currentProjectId === projectId : !t.currentProjectId));

    const buildCrews = (projectId: string, jobHit: boolean) => {
      const rows = forProject(projectId);
      const byForeman = new Map<string, ToolRow[]>();
      for (const t of rows) {
        if (!t.custodianId) continue;
        const arr = byForeman.get(t.custodianId) ?? [];
        arr.push(t);
        byForeman.set(t.custodianId, arr);
      }
      const crews: Crew[] = [];
      byForeman.forEach((crewTools, foremanId) => {
        if (foremanFilter && foremanId !== foremanFilter) return;
        const person = allCustodians.find((f) => f.id === foremanId);
        const rig = rigOf(foremanId, vehicles.data ?? []);
        const rigText = `${person?.name ?? ""} ${rig.truck?.unit ?? ""} ${rig.truck?.makeModel ?? ""} ${rig.trailer?.unit ?? ""}`;
        const visible = crewTools.filter(
          (t) =>
            (jobHit || hit(`${t.tag ?? ""} ${t.serialNumber ?? ""} ${formatAssetModel(t)} ${rigText}`)) &&
            (!statusFilter || t.status === statusFilter),
        );
        crews.push({
          id: `${projectId}:${foremanId}`,
          foremanId,
          foremanExternalId: person?.externalId ?? null,
          foremanName: person?.name ?? "Unknown",
          foremanRole: person?.role ?? "",
          rig,
          tools: visible,
          /* One foreman, several jobs: the same rig shows on each of their cards. */
          otherJobs: new Set(
            tools.filter((t) => t.custodianId === foremanId && t.currentProjectId && t.currentProjectId !== projectId).map((t) => t.currentProjectId),
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
          !t.custodianId &&
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
      out.push({ id: p.id, name: p.name, code: p.externalId, isJob: true, crews, loose, toolCount, value, gaps, tint: "bg-primary/5" });
    }

    if (!scope && !foremanFilter && (!jobFilter || jobFilter === YARD || jobFilter === NOJOB)) {
      /*
        The default group: foremen not assigned to any project — pinned at the
        bottom of the list, always. A foreman with no primary project lives
        here — even holding nothing, because this is where you go to hand them
        tools. Their crew is their held tools that are not booked to a job.
        The rig follows the person, so a project-less foreman's truck and
        trailer show here too.
      */
      const noJobCrews: Crew[] = [];
      for (const f of foremen) {
        if (f.primaryProjectId) continue;
        const crewTools = forProject(null).filter((t) => t.custodianId === f.id);
        const rig = rigOf(f.id, vehicles.data ?? []);
        const visible = crewTools.filter(
          (t) =>
            hit(`${t.tag ?? ""} ${t.serialNumber ?? ""} ${formatAssetModel(t)}`) &&
            (!statusFilter || t.status === statusFilter),
        );
        noJobCrews.push({
          id: `${NOJOB}:${f.id}`,
          foremanId: f.id,
          foremanExternalId: f.externalId ?? null,
          foremanName: f.name ?? "Unknown",
          foremanRole: f.role ?? "",
          rig,
          tools: visible,
          otherJobs: 0,
        });
      }
      noJobCrews.sort((a, b) => a.foremanName.localeCompare(b.foremanName));

      /* Same rule as the job cards: a tool a person holds is not "loose", even
         in the yard — Dave's shop tools are held, just not booked to a job. */
      const yardTools = forProject(null).filter(
        (t) =>
          !t.custodianId &&
          hit(`${t.tag ?? ""} ${t.serialNumber ?? ""} ${formatAssetModel(t)} yard`) &&
          (!statusFilter || t.status === statusFilter),
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
        tint: CARD_TINT[YARD] ?? "",
      });

      /* The not-assigned group comes last, even when it is empty — it is the
         permanent home for project-less foremen, not a section that comes and
         goes with the current roster. */
      const noJobToolCount = noJobCrews.reduce((n, c) => n + c.tools.length, 0);
      out.push({
        id: NOJOB,
        name: "Not assigned to any project",
        code: null,
        isJob: false,
        crews: noJobCrews,
        loose: [],
        toolCount: noJobToolCount,
        value: noJobCrews.reduce((n, c) => n + c.tools.reduce((m, t) => m + (Number(t.acquisitionCost) || 0), 0), 0),
        gaps: [],
        tint: CARD_TINT[NOJOB] ?? "",
      });
    }

    return out.filter((c) => {
      /* The not-assigned group is pinned at the bottom permanently — it must
         survive filters that prune everything else. */
      if (c.id === NOJOB) return true;
      if (onlyGaps && !c.gaps.length) return false;
      /* A card filtered down to nothing is noise, not information. */
      if (anyFilter && c.toolCount === 0 && c.crews.length === 0) return false;
      return true;
    });
  }, [assets.data, projects.data, foremen, allCustodians, vehicles.data, scope, q, jobFilter, foremanFilter, statusFilter, onlyGaps, anyFilter]);

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
      <CrewAssignDialog
        request={assign}
        onClose={() => setAssign(null)}
        onDone={() => {
          setSelectedLoose({});
          invalidate();
        }}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Crews on jobs" value={shownCrews} hint="one foreman and their truck & trailer, per job" />
        <Metric label="Tools out" value={shownTools} hint={`across ${cards.length} cards`} />
        <Metric label="Fleet value out" value={money(cards.reduce((n, c) => n + c.value, 0))} hint="acquisition cost" />
        <Metric label="Crews without a truck" value={crewsWithoutTruck} tone={crewsWithoutTruck ? "warn" : "ok"} hint="cannot haul their tools" />
      </div>

      <div className={cn("grid gap-4", showActivity && "lg:grid-cols-[minmax(0,1fr)_320px]")}>
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
              <SearchSelect
                value={jobFilter}
                onChange={setJobFilter}
                placeholder="All jobs"
                widthClass="w-56"
                options={[
                  ...(projects.data ?? []).map((p) => ({
                    value: p.id,
                    label: p.externalId ? `${p.externalId} · ${p.name}` : p.name,
                  })),
                  { value: YARD, label: "URB-YARD · Equipment Yard" },
                  { value: NOJOB, label: "Not assigned to any project" },
                ]}
              />
              <SearchSelect
                value={foremanFilter}
                onChange={setForemanFilter}
                placeholder="All foremen"
                widthClass="w-48"
                options={foremen.map((f) => ({
                  value: f.id,
                  label: f.externalId ? `${f.externalId} · ${f.name}` : f.name,
                }))}
              />
              <SearchSelect
                value={statusFilter}
                onChange={setStatusFilter}
                placeholder="Any status"
                widthClass="w-44"
                options={["assigned", "available", "in_maintenance", "lost"].map((s) => ({
                  value: s,
                  label: humanize(s),
                }))}
              />
              <Button variant={onlyGaps ? "secondary" : "outline"} size="sm" onClick={() => setOnlyGaps((v) => !v)}>
                <TriangleAlert className="size-3.5" /> No truck or trailer
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCollapseAll((v) => !v)}
                  title={collapseAll ? "Expand every card and tool table" : "Collapse every card and tool table"}
                >
                  {collapseAll ? (
                    <>
                      <Eye className="size-3.5" /> Expand all
                    </>
                  ) : (
                    <>
                      <ChevronDown className="size-3.5 rotate-180" /> Collapse all
                    </>
                  )}
                </Button>
                {!showActivity ? (
                  <Button variant="outline" size="sm" onClick={() => setShowActivity(true)}>
                    <Eye className="size-3.5" /> Show activity
                  </Button>
                ) : null}
              </div>
            </div>
          </section>

          {!cards.length ? (
            <EmptyState icon={Building2} title="Nothing matches those filters" description="Clear a filter, or search for a different unit." />
          ) : null}

          {cards.map((card) => {
            const open = collapseAll ? (openJobs[card.id] ?? false) : (openJobs[card.id] ?? true);
            /* Each card kind has its own icon: jobs are sites, the yard is the
               warehouse, the project-less people are a crew waiting for work. */
            const CardIcon = card.id === NOJOB ? Users : card.id === YARD ? Warehouse : Building2;
            return (
              <section key={card.id} className="overflow-visible rounded-md border bg-card">
                <header className={cn("flex flex-wrap items-center gap-3 px-3 py-2.5", card.tint)}>
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", card.isJob ? "bg-accent text-primary" : "bg-muted/70 text-muted-foreground")}>
                    <CardIcon className="size-4.5" aria-hidden />
                  </span>
                  <span className="flex min-w-40 flex-1 flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">
                      <Highlight text={card.name} q={q} />
                    </span>
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
                    {card.isJob && canAssignCrew ? (
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
                        {card.isJob && canAssignCrew ? (
                          <DropdownMenuItem onSelect={() => setPicker({ kind: "crew", projectId: card.id })}>Add a foreman and truck/trailer</DropdownMenuItem>
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
                    {card.crews.map((crew, i) => (
                      <CrewCard
                        key={crew.id}
                        crew={crew}
                        expanded={collapseAll ? (openCrews[crew.id] ?? false) : (openCrews[crew.id] ?? true)}
                        onToggle={() => setOpenCrews((o) => ({ ...o, [crew.id]: !(collapseAll ? (o[crew.id] ?? false) : (o[crew.id] ?? true)) }))}
                        onPick={setPicker}
                        onAddTools={
                          canAssignTools
                            ? () => setAssign({ mode: "pickTools", foremanId: crew.foremanId, foremanName: crew.foremanName })
                            : undefined
                        }
                        canManage={canDrive}
                        canAct={canActTools}
                        striped={i % 2 === 1}
                        highlight={q}
                        projectId={card.id}
                      />
                    ))}

                    {card.isJob && !card.crews.length && canAssignCrew ? (
                      <button
                        type="button"
                        onClick={() => setPicker({ kind: "crew", projectId: card.id })}
                        className="rounded-md border border-dashed bg-card p-4 text-left text-sm font-medium text-primary"
                      >
                        No crew on this job yet — add a foreman with a truck or trailer.
                      </button>
                    ) : null}

                    {card.id === NOJOB && !card.crews.length ? (
                      <p className="rounded-md border border-dashed bg-card px-4 py-3 text-sm text-muted-foreground">
                        Every foreman is on a project right now — this group holds whoever is between jobs.
                      </p>
                    ) : null}
                    {card.loose.length ? (
                      <LooseSection
                        isJob={card.isJob}
                        rows={card.loose}
                        selected={selectedLoose[card.id] ?? new Set<string>()}
                        canAssign={canAssignTools}
                        canAct={canActTools}
                        highlight={q}
                        onToggle={(assetId) =>
                          setSelectedLoose((m) => {
                            const cur = m[card.id] ?? new Set<string>();
                            const next = new Set(cur);
                            if (next.has(assetId)) next.delete(assetId);
                            else next.add(assetId);
                            return { ...m, [card.id]: next };
                          })
                        }
                        onAssign={() =>
                          setAssign({ mode: "pickForeman", assetIds: [...(selectedLoose[card.id] ?? [])] })
                        }
                        onClear={() => setSelectedLoose((m) => ({ ...m, [card.id]: new Set<string>() }))}
                      />
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>

        {showActivity ? (
          <aside className="h-fit lg:sticky lg:top-4">
            <JobsiteActivity
              projectOptions={(projects.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
              onHide={() => setShowActivity(false)}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/*
  The "On site, nobody holding" / "Waiting in the yard" block.

  The header carries a subtle tint so each section reads as its own thing (the
  confusing part of the old layout was every header looking identical). When
  the viewer may hand tools out (`assignment.create`), each row gets a checkbox
  and the header shows how many are ticked with an "Assign to foreman…" action
  — the tools move to wherever the chosen foreman works.
*/
function LooseSection({
  isJob,
  rows,
  selected,
  canAssign,
  canAct,
  highlight,
  onToggle,
  onAssign,
  onClear,
}: {
  isJob: boolean;
  rows: ToolRow[];
  selected: Set<string>;
  canAssign: boolean;
  canAct: boolean;
  highlight: string;
  onToggle: (assetId: string) => void;
  onAssign: () => void;
  onClear: () => void;
}) {
  const n = selected.size;
  const SectionIcon = isJob ? PackageOpen : Package;
  return (
    /* The whole block takes its own tint so unassigned tools read differently
       from the foreman crew cards around them. */
    <div className={cn("overflow-hidden rounded-md border", isJob ? "border-primary/15 bg-primary/5" : "border-muted/60 bg-muted/10")}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs font-semibold",
          isJob ? "border-primary/15 bg-primary/10" : "border-muted/60 bg-muted/30",
        )}
      >
        <SectionIcon className="size-3.5 text-muted-foreground" aria-hidden />
        {isJob ? "On site, nobody holding" : "Waiting in the yard"}
        <span className="tnum font-normal text-muted-foreground">{rows.length}</span>
        {canAssign ? (
          <span className="ml-auto flex items-center gap-1.5">
            {n > 0 ? (
              <>
                <span className="tnum text-primary">{n} selected</span>
                <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onAssign}>
                  Assign to foreman…
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onClear}>
                  Clear
                </Button>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
      <ToolTable
        rows={rows}
        showWhere
        selectable={canAssign}
        selectedIds={selected}
        onToggle={onToggle}
        highlight={highlight}
        actions={canAct}
      />
    </div>
  );
}
