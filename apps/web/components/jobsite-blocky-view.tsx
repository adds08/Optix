"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Container, Plus, Search, TriangleAlert, Truck, X } from "lucide-react";
import { formatAssetModel } from "@stinventory/types";
import { rigOf, type RigVehicle } from "@/lib/rig";
import { money } from "@/lib/format";
import type { ToolRow } from "@/components/jobsite-tool-table";
import type { PickerRequest } from "@/components/rig-picker";
import styles from "./jobsite-blocky.module.css";
import { cn } from "@/lib/utils";

/*
  Tools by Jobsite — "Blocky" concept view, ported pixel-for-pixel from
  `design/claude-design/Tools by Jobsite Blocky.dc.html` so the client can
  compare two renderings of the same data and pick the one they like.

  Same jobs → crews → tools grouping as the cards view (the comment block at
  the top of `app/(app)/jobsites/page.tsx` explains the model), same actions
  (rig picker, crew assign), same permission gates — only the presentation
  differs. The design's dark palette lives in `jobsite-blocky.module.css` and
  is scoped to this component, so the app's light theme is untouched.

  Deliberate adaptations where the design mocks data the system does not hold:
    - the design's TIME OUT column ("out 3d") becomes LOCATION — where the tool
      actually rides right now, which is the question the desk asks,
    - the design's crew "updated" timestamp becomes the foreman's role,
    - the "Unassigned pool" is the yard: tools held by nobody and booked to no
      job, with their warehouse/yard location (the design shows the same idea).
*/

type Employee = {
  id: string;
  externalId: string | null;
  name: string | null;
  role: string | null;
  employmentStatus: string | null;
  primaryProjectId: string | null;
};

type Project = {
  id: string;
  name: string;
  externalId: string | null;
  siteAddress: string | null;
};

type BlockyCrew = {
  id: string;
  foremanId: string;
  foremanName: string;
  role: string;
  truck: string | null;
  trailer: string | null;
  truckModel: string | null;
  trailerModel: string | null;
  tools: ToolRow[];
  value: number;
};

type BlockyJob = {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  crews: BlockyCrew[];
  loose: ToolRow[];
  toolCount: number;
  value: number;
  gaps: number;
  noCrew: boolean;
};

const SORT_LABELS: Record<string, string> = {
  tools: "Tools out",
  value: "Value on site",
  gaps: "Vehicle gaps",
  name: "Job name",
};

/* The design's condition pills: Good / Fair / Needs service. The register's
   `condition` field (new | good | fair | poor | damaged) maps onto them;
   anything unknown falls back to the tool's status. */
const CONDITION_META: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "#4FA97A" },
  good: { label: "Good", color: "#4FA97A" },
  fair: { label: "Fair", color: "#E4A13B" },
  poor: { label: "Needs service", color: "#D2694A" },
  damaged: { label: "Needs service", color: "#D2694A" },
};

function conditionOf(t: ToolRow): { label: string; color: string } {
  const known = t.condition ? CONDITION_META[t.condition] : undefined;
  if (known) return known;
  if (!t.status) return { label: "—", color: "#8A939C" };
  const status = t.status.toLowerCase();
  if (status === "in_maintenance") return { label: "In maintenance", color: "#E4A13B" };
  if (status === "lost") return { label: "Lost", color: "#D2694A" };
  return { label: "Out", color: "#4FA97A" };
}

/* The pool's status column — the design's "Ready" or "N days idle". We have no
   idle-day data, so the nearest honest reading is the tool's own status. */
function poolStatus(t: ToolRow): { label: string; color: string } {
  if (!t.status) return { label: "Ready", color: "#4FA97A" };
  const status = t.status.toLowerCase();
  if (status === "available" || status === "received") return { label: "Ready", color: "#4FA97A" };
  if (status === "in_maintenance") return { label: "In maintenance", color: "#E4A13B" };
  if (status === "lost") return { label: "Lost", color: "#D2694A" };
  if (status === "reserved") return { label: "Reserved", color: "#8A939C" };
  return { label: "On site", color: "#7FB0E4" };
}

const NOJOB = "__nojob";

export function JobsiteBlockyView({
  assets,
  projects,
  vehicles,
  employees,
  foremen,
  scope,
  canAssignCrew,
  canManageRig,
  onPick,
}: {
  assets: ToolRow[];
  projects: Project[];
  vehicles: RigVehicle[];
  employees: Employee[];
  foremen: Employee[];
  scope: Set<string> | null;
  canAssignCrew: boolean;
  canManageRig: boolean;
  onPick: (r: PickerRequest) => void;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("tools");
  const [sortOpen, setSortOpen] = useState(false);
  const [tab, setTab] = useState<"jobs" | "pool">("jobs");
  const [gapsOnly, setGapsOnly] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [openCrews, setOpenCrews] = useState<Record<string, boolean>>({});

  const query = q.trim().toLowerCase();

  const allCustodians = employees;

  /* ---- jobs → crews → tools (same grouping as the cards view) ---- */
  const jobs = useMemo(() => {
    const tools = assets;
    const out: BlockyJob[] = [];

    const forProject = (projectId: string | null) =>
      tools.filter((t) => (projectId ? t.currentProjectId === projectId : !t.currentProjectId));

    const buildCrews = (projectId: string | null): BlockyCrew[] => {
      const rows = forProject(projectId);
      const byForeman = new Map<string, ToolRow[]>();
      for (const t of rows) {
        if (!t.custodianId) continue;
        const arr = byForeman.get(t.custodianId) ?? [];
        arr.push(t);
        byForeman.set(t.custodianId, arr);
      }
      const crews: BlockyCrew[] = [];
      byForeman.forEach((crewTools, foremanId) => {
        const person = allCustodians.find((f) => f.id === foremanId);
        const rig = rigOf(foremanId, vehicles);
        crews.push({
          id: `${projectId ?? "none"}:${foremanId}`,
          foremanId,
          foremanName: person?.name ?? "Unknown",
          role: person?.role ?? "",
          truck: rig.truck?.unit ?? null,
          trailer: rig.trailer?.unit ?? null,
          truckModel: rig.truck?.makeModel ?? null,
          trailerModel: rig.trailer?.makeModel ?? null,
          tools: crewTools,
          value: crewTools.reduce((n, t) => n + (Number(t.acquisitionCost) || 0), 0),
        });
      });
      return crews.sort((a, b) => a.foremanName.localeCompare(b.foremanName));
    };

    for (const p of projects) {
      if (scope && !scope.has(p.id)) continue;
      const crews = buildCrews(p.id);
      const loose = forProject(p.id).filter((t) => !t.custodianId);
      const toolCount = crews.reduce((n, c) => n + c.tools.length, 0) + loose.length;
      const value =
        crews.reduce((n, c) => n + c.value, 0) + loose.reduce((n, t) => n + (Number(t.acquisitionCost) || 0), 0);
      const gaps = crews.filter((c) => !c.truck || !c.trailer).length;
      out.push({
        id: p.id,
        name: p.name,
        code: p.externalId,
        city: p.siteAddress,
        crews,
        loose,
        toolCount,
        value,
        gaps,
        noCrew: crews.length === 0,
      });
    }

    /* Foremen not assigned to any project — pinned at the bottom, always,
       exactly as in the cards view. */
    const noJobCrews: BlockyCrew[] = [];
    for (const f of foremen) {
      if (f.primaryProjectId) continue;
      const crewTools = forProject(null).filter((t) => t.custodianId === f.id);
      const rig = rigOf(f.id, vehicles);
      noJobCrews.push({
        id: `nojob:${f.id}`,
        foremanId: f.id,
        foremanName: f.name ?? "Unknown",
        role: f.role ?? "",
        truck: rig.truck?.unit ?? null,
        trailer: rig.trailer?.unit ?? null,
        truckModel: rig.truck?.makeModel ?? null,
        trailerModel: rig.trailer?.makeModel ?? null,
        tools: crewTools,
        value: crewTools.reduce((n, t) => n + (Number(t.acquisitionCost) || 0), 0),
      });
    }
    noJobCrews.sort((a, b) => a.foremanName.localeCompare(b.foremanName));

    if (!scope) {
      out.push({
        id: NOJOB,
        name: "Not assigned to any project",
        code: null,
        city: null,
        crews: noJobCrews,
        loose: [],
        toolCount: noJobCrews.reduce((n, c) => n + c.tools.length, 0),
        value: noJobCrews.reduce((n, c) => n + c.value, 0),
        gaps: noJobCrews.filter((c) => !c.truck || !c.trailer).length,
        noCrew: noJobCrews.length === 0,
      });
    }
    return out;
  }, [assets, projects, vehicles, allCustodians, foremen, scope]);

  /* ---- pool: tools nobody holds, booked to no job (the yard) ---- */
  const pool = useMemo(
    () =>
      assets.filter(
        (t) =>
          !t.custodianId &&
          !t.currentProjectId &&
          (!query ||
            `${t.tag ?? ""} ${t.serialNumber ?? ""} ${formatAssetModel(t)} ${t.categoryName ?? ""} ${t.locationName ?? ""}`
              .toLowerCase()
              .includes(query)),
      ),
    [assets, query],
  );

  /* ---- KPI summary across every job (like the design, unfiltered) ---- */
  const kpis = useMemo(() => {
    const allCrews = jobs.flatMap((j) => j.crews);
    const withTruck = allCrews.filter((c) => c.truck).length;
    const withTrailer = allCrews.filter((c) => c.trailer).length;
    const fullyRigged = allCrews.filter((c) => c.truck && c.trailer).length;
    const toolsOut = jobs.reduce((n, j) => n + j.toolCount, 0);
    const value = jobs.reduce((n, j) => n + j.value, 0);
    const sum = (accent?: string) => ({ color: accent ?? "#FFFFFF" });
    return [
      { label: "JOBS", value: String(jobs.length), ...sum() },
      { label: "CREWS", value: String(allCrews.length), ...sum() },
      { label: "WITH TRUCK", value: `${withTruck}/${allCrews.length}`, ...sum(withTruck === allCrews.length ? "#4FA97A" : "#E4A13B") },
      { label: "WITH TRAILER", value: `${withTrailer}/${allCrews.length}`, ...sum(withTrailer === allCrews.length ? "#4FA97A" : "#E4A13B") },
      { label: "FULLY RIGGED", value: `${fullyRigged}/${allCrews.length}`, ...sum(fullyRigged === allCrews.length ? "#4FA97A" : "#E4A13B") },
      { label: "TOOLS OUT", value: String(toolsOut), ...sum() },
      { label: "VALUE", value: money(value), ...sum() },
    ];
  }, [jobs]);

  /* ---- filter + sort the job list ---- */
  const list = useMemo(() => {
    let rows = jobs.filter((j) => {
      if (gapsOnly && j.gaps === 0) return false;
      if (!query) return true;
      const haystack = [
        j.name,
        j.code ?? "",
        j.city ?? "",
        ...j.crews.flatMap((c) => [c.foremanName, c.truck ?? "", c.trailer ?? "", ...c.tools.flatMap((t) => [t.tag ?? "", t.serialNumber ?? "", formatAssetModel(t), t.categoryName ?? ""])]),
        ...j.loose.flatMap((t) => [t.tag ?? "", t.serialNumber ?? "", formatAssetModel(t), t.categoryName ?? ""]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
    const SORTS: Record<string, (a: BlockyJob, b: BlockyJob) => number> = {
      tools: (a, b) => b.toolCount - a.toolCount,
      value: (a, b) => b.value - a.value,
      gaps: (a, b) => b.gaps - a.gaps,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    rows = rows.slice().sort(SORTS[sort] ?? SORTS.tools);
    /* The "not assigned" group stays pinned last whatever the sort. */
    const pinned = rows.filter((j) => j.id === NOJOB);
    const rest = rows.filter((j) => j.id !== NOJOB);
    return [...rest, ...pinned];
  }, [jobs, gapsOnly, query, sort]);

  const fleetCount = assets.length;

  const open = (jobId: string) => !closed[jobId];

  const poolRows = pool.map((p, i) => {
    const st = poolStatus(p);
    const cond = conditionOf(p);
    return {
      tag: p.tag ?? p.serialNumber ?? "Untagged",
      name: formatAssetModel(p) || "No description",
      cat: p.categoryName ?? "—",
      loc: p.locationName ?? "—",
      statusLabel: st.label,
      statusColor: st.color,
      condLabel: cond.label,
      condColor: cond.color,
      rowClass: cn(styles.poolRow, i % 2 ? styles.poolRowB : styles.poolRowA),
    };
  });

  return (
    <div className={styles.page}>
      <div className={cn(styles.container)}>
        {/* ---- header ---- */}
        <div className={styles.headerBar}>
          <div className={styles.titleRow}>
            <div>
              <div className={styles.eyebrow}>FLEET · DISTRIBUTION</div>
              <h1 className={styles.title}>Tools by Jobsite</h1>
            </div>
            <div className={styles.kpis}>
              {kpis.map((k) => (
                <div key={k.label} className={styles.kpi}>
                  <div className={styles.kpiLabel}>{k.label}</div>
                  <div className={styles.kpiValue} style={{ color: k.color }}>
                    {k.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ---- toolbar ---- */}
          <div className={styles.toolbar}>
            <div className={styles.tabs}>
              <button type="button" className={cn(styles.tab, tab === "jobs" && styles.tabOn)} onClick={() => setTab("jobs")}>
                Jobs
                <span className={cn(styles.tabCount, tab === "jobs" && styles.tabCountOn)}>{jobs.length}</span>
              </button>
              <button type="button" className={cn(styles.tab, tab === "pool" && styles.tabOn)} onClick={() => setTab("pool")}>
                Unassigned pool
                <span className={cn(styles.tabCount, tab === "pool" && styles.tabCountOn)}>{pool.length}</span>
              </button>
            </div>

            <div className={styles.searchBox}>
              <Search size={14} stroke="#8A939C" strokeWidth={2} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search job, crew, tool, tag…"
                className={styles.searchInput}
                aria-label="Search the jobsite list"
              />
              {q ? (
                <button type="button" onClick={() => setQ("")} aria-label="Clear search" style={{ cursor: "pointer", color: "#8A939C", fontSize: 15, lineHeight: 1, border: "none", background: "transparent", padding: 0 }}>
                  <X size={13} />
                </button>
              ) : null}
            </div>

            <div className={styles.sortWrap}>
              <button type="button" className={styles.sortBtn} onClick={() => setSortOpen((v) => !v)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8A939C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3" />
                </svg>
                {SORT_LABELS[sort] ?? "Tools out"}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8A939C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9.5l6 6 6-6" />
                </svg>
              </button>
              {sortOpen ? (
                <div className={styles.sortMenu}>
                  {Object.entries(SORT_LABELS).map(([k, label]) => (
                    <div
                      key={k}
                      className={cn(styles.sortItem, sort === k && styles.sortItemOn)}
                      onClick={() => {
                        setSort(k);
                        setSortOpen(false);
                      }}
                    >
                      {label}
                      {sort === k ? <span className={styles.sortItemCheck}>✓</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <button type="button" className={cn(styles.gapChip, gapsOnly && styles.gapChipOn)} onClick={() => setGapsOnly((v) => !v)} aria-pressed={gapsOnly}>
              <TriangleAlert size={12} stroke="currentColor" strokeWidth={2} />
              Needs vehicle
            </button>
          </div>
        </div>

        {/* ---- body ---- */}
        <div className={styles.body}>
          {tab === "jobs" ? (
            list.length === 0 ? (
              <div className={styles.empty}>No jobs, crews, or tools match “{q}”.</div>
            ) : (
              list.map((job) => {
                const isOpen = open(job.id);
                return (
                  <div key={job.id} className={styles.jobBlock}>
                    <div className={cn(styles.jobEdge, job.gaps > 0 ? styles.jobEdgeGap : styles.jobEdgeOk)} />
                    <div className={styles.jobInner}>
                      {/* job header */}
                      <div className={styles.jobHeader} onClick={() => setClosed((c) => ({ ...c, [job.id]: !c[job.id] }))}>
                        <ChevronRight
                          size={13}
                          stroke="#8A939C"
                          strokeWidth={2.4}
                          style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", flex: "none" }}
                        />
                        <span className={styles.jobName}>{job.name}</span>
                        {job.code ? <span className={styles.codeBadge}>{job.code}</span> : null}
                        {job.city ? <span className={styles.jobCity}>{job.city}</span> : null}
                        <div style={{ flex: 1 }} />
                        {job.gaps > 0 ? (
                          <span className={styles.gapLabel}>
                            <TriangleAlert size={12} stroke="#E4A13B" strokeWidth={2} />
                            {job.gaps === 1 ? "1 crew needs a vehicle" : `${job.gaps} crews need vehicles`}
                          </span>
                        ) : null}
                        <span className={styles.crewSummary}>
                          {job.crews.length} {job.crews.length === 1 ? "crew" : "crews"} · {job.toolCount} tools
                        </span>
                        {job.id !== NOJOB && canAssignCrew ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPick({ kind: "crew", projectId: job.id });
                            }}
                            style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(127,176,228,.12)", border: "1px solid rgba(127,176,228,.4)", color: "#7FB0E4", borderRadius: 3, padding: "3px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                          >
                            <Plus size={11} /> crew
                          </button>
                        ) : null}
                      </div>

                      {isOpen ? (
                        <div>
                          {/* metrics row */}
                          <div className={styles.metricsRow}>
                            {[
                              { label: "TOOLS OUT", value: String(job.toolCount), suffix: "" },
                              { label: "CREWS", value: String(job.crews.length), suffix: "" },
                              { label: "TRUCKS", value: String(job.crews.filter((c) => c.truck).length), suffix: `/ ${job.crews.length}`, warn: job.crews.some((c) => !c.truck) },
                              { label: "TRAILERS", value: String(job.crews.filter((c) => c.trailer).length), suffix: `/ ${job.crews.length}`, warn: job.crews.some((c) => !c.trailer) },
                              { label: "VALUE", value: money(job.value), suffix: "" },
                            ].map((m, i) => (
                              <div
                                key={m.label}
                                className={styles.metricCell}
                                style={i < 4 ? { borderRight: "1px solid #1B2027" } : undefined}
                              >
                                <span className={styles.metricLabel}>{m.label}</span>
                                <span className={styles.metricValue}>
                                  <span className={cn(styles.metricNum, m.warn && styles.metricNumWarn)}>{m.value}</span>
                                  {m.suffix ? <span className={styles.metricSuffix}>{m.suffix}</span> : null}
                                </span>
                              </div>
                            ))}
                          </div>

                          {job.noCrew && job.id !== NOJOB ? (
                            <p style={{ padding: "12px 20px", fontSize: 12.5, color: "#8A939C", borderBottom: "1px solid #1B2027" }}>
                              No crew on this job yet.
                            </p>
                          ) : null}

                          {/* crew rows */}
                          {job.crews.map((c, i) => {
                            const cOpen = !!openCrews[c.id];
                            const rigged = c.truck && c.trailer;
                            return (
                              <div key={c.id} style={{ borderTop: i === 0 ? "none" : "1px solid #171C22" }}>
                                <div className={styles.crewRow} onClick={() => setOpenCrews((o) => ({ ...o, [c.id]: !o[c.id] }))}>
                                  <span className={cn(styles.crewTick, rigged ? styles.crewTickOk : styles.crewTickGap)} />
                                  <ChevronRight
                                    size={12}
                                    stroke="#8A939C"
                                    strokeWidth={2.4}
                                    style={{ transform: cOpen ? "rotate(90deg)" : "none", transition: "transform .15s", flex: "none" }}
                                  />
                                  <span className={styles.crewName} title={c.foremanName}>
                                    {c.foremanName}
                                  </span>
                                  <div className={styles.vehicleArea}>
                                    {c.truck ? (
                                      <span className={styles.vehicleChip} title={c.truckModel ?? undefined}>
                                        <Truck size={12} stroke="#8A939C" strokeWidth={2} /> {c.truck}
                                      </span>
                                    ) : canManageRig ? (
                                      <button
                                        type="button"
                                        className={styles.addVehicleBtn}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onPick({ kind: "truck", foremanId: c.foremanId });
                                        }}
                                      >
                                        <Plus size={11} /> truck
                                      </button>
                                    ) : null}
                                  </div>
                                  <div className={styles.vehicleArea}>
                                    {c.trailer ? (
                                      <span className={styles.vehicleChip} title={c.trailerModel ?? undefined}>
                                        <Container size={12} stroke="#8A939C" strokeWidth={2} /> {c.trailer}
                                      </span>
                                    ) : canManageRig ? (
                                      <button
                                        type="button"
                                        className={styles.addVehicleBtn}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onPick({ kind: "trailer", foremanId: c.foremanId });
                                        }}
                                      >
                                        <Plus size={11} /> trailer
                                      </button>
                                    ) : null}
                                  </div>
                                  <div style={{ flex: 1 }} />
                                  <span className={styles.crewMeta}>{c.role}</span>
                                  <span className={styles.crewToolCount}>{c.tools.length}</span>
                                  <span className={styles.crewToolLabel}>tools</span>
                                </div>

                                {cOpen ? (
                                  <div style={{ borderTop: "1px solid #1B2027", background: "#0A0D11" }}>
                                    {/* tool table */}
                                    <div className={styles.toolHeader}>
                                      <span className={styles.colLabel} style={{ width: 88, flex: "none" }}>TAG</span>
                                      <span className={styles.colLabel} style={{ flex: 1 }}>TOOL</span>
                                      <span className={styles.colLabel} style={{ width: 104, flex: "none" }}>CATEGORY</span>
                                      <span className={styles.colLabel} style={{ width: 96, flex: "none" }}>LOCATION</span>
                                      <span className={styles.colLabel} style={{ width: 104, flex: "none", textAlign: "right" }}>CONDITION</span>
                                    </div>
                                    {c.tools.map((t, k) => {
                                      const cond = conditionOf(t);
                                      return (
                                        <div key={t.id} className={cn(styles.toolRow, k % 2 ? styles.toolRowB : styles.toolRowA)}>
                                          <span className={styles.toolTag}>{t.tag ?? t.serialNumber ?? "Untagged"}</span>
                                          <span className={styles.toolName} title={formatAssetModel(t) ?? undefined}>
                                            {formatAssetModel(t) || "No description"}
                                          </span>
                                          <span className={styles.catCol}>{t.categoryName ?? "—"}</span>
                                          <span className={styles.whereCol}>{t.locationName ?? "—"}</span>
                                          <span className={styles.condCol} style={{ color: cond.color }}>
                                            {cond.label}
                                          </span>
                                        </div>
                                      );
                                    })}
                                    <div className={styles.crewFooter}>
                                      <span className={styles.footerLabel}>
                                        {c.tools.length} TOOLS · {c.foremanName.toUpperCase()}
                                      </span>
                                      <div style={{ flex: 1 }} />
                                      <span className={styles.footerValue}>VALUE {money(c.value)}</span>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}

                          {/* loose tools on the job */}
                          {job.loose.length ? (
                            <div style={{ borderTop: "1px solid #1B2027", background: "#0A0D11" }}>
                              <div className={styles.toolHeader}>
                                <span className={styles.footerLabel}>ON SITE, NOBODY HOLDING · {job.loose.length}</span>
                              </div>
                              {job.loose.slice(0, 5).map((t, k) => {
                                const cond = conditionOf(t);
                                return (
                                  <div key={t.id} className={cn(styles.toolRow, k % 2 ? styles.toolRowB : styles.toolRowA)}>
                                    <span className={styles.toolTag}>{t.tag ?? t.serialNumber ?? "Untagged"}</span>
                                    <span className={styles.toolName}>{formatAssetModel(t) || "No description"}</span>
                                    <span className={styles.catCol}>{t.categoryName ?? "—"}</span>
                                    <span className={styles.whereCol}>{t.locationName ?? "—"}</span>
                                    <span className={styles.condCol} style={{ color: cond.color }}>
                                      {cond.label}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )
          ) : (
            /* ---- unassigned pool ---- */
            <div className={styles.poolBlock}>
              <div className={styles.poolHeader}>
                <span className={styles.poolTitle}>Unassigned pool</span>
                <span className={styles.poolCount}>{pool.length} TOOLS</span>
                <span className={styles.poolDesc}>sitting in warehouses, not out on a job</span>
                {fleetCount ? <span style={{ marginLeft: "auto", fontSize: 11, color: "#8A939C" }}>{fleetCount} tools in the fleet</span> : null}
              </div>
              <div className={styles.poolColHeader}>
                <span className={styles.colLabel} style={{ width: 88, flex: "none" }}>TAG</span>
                <span className={styles.colLabel} style={{ flex: 1 }}>TOOL</span>
                <span className={styles.colLabel} style={{ width: 104, flex: "none" }}>CATEGORY</span>
                <span className={styles.colLabel} style={{ width: 212, flex: "none" }}>LOCATION</span>
                <span className={styles.colLabel} style={{ width: 104, flex: "none", textAlign: "right" }}>STATUS</span>
              </div>
              {poolRows.length === 0 ? (
                <div className={styles.empty}>Nothing in the pool{query ? ` for “${q}”` : ""}.</div>
              ) : (
                poolRows.map((p) => (
                  <div key={p.tag} className={p.rowClass}>
                    <span className={styles.toolTag}>{p.tag}</span>
                    <span className={styles.toolName}>{p.name}</span>
                    <span className={styles.catCol}>{p.cat}</span>
                    <span className={styles.poolLoc}>{p.loc}</span>
                    <span className={styles.poolStatus} style={{ color: p.statusColor }}>
                      {p.statusLabel}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
