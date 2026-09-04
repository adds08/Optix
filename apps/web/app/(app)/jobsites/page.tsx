"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronRight, Package, PackageOpen, Plus, Search, TriangleAlert, Users, Warehouse, Eye, ArrowDownWideNarrow } from "lucide-react";
import { CUSTODIAN_ROLES, formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { useJobScope } from "@/components/job-scope";
import { usePermissions } from "@/components/use-permissions";
import { TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { FilterSheet } from "@/components/sti/data-table/filter-sheet";
import { FilterPills, FilterField } from "@/components/sti/facets";
import { isHighValue } from "@/components/sti/flags";
import { CrewCard, type Crew } from "@/components/jobsite-crew-card";
import { JobsiteCardView } from "@/components/jobsite-card-view";
import { JobsiteTeamStrip } from "@/components/jobsite-team-strip";
import { RigPicker, type PickerRequest } from "@/components/rig-picker";
import { CrewAssignDialog, type CrewAssignRequest } from "@/components/crew-assign-dialog";
import { ToolTable, type ToolRow } from "@/components/jobsite-tool-table";
import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import { ActionMenuTrigger } from "@/components/sti/action-menu";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SearchSelect } from "@/components/ui/search-select";
import { humanize } from "@/components/sti/status";
import { rigOf } from "@/lib/rig";
import { moneyShort } from "@/lib/format";
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

/*
  The equipment department's own holding project, which is not a job.

  Urban carries a project literally called "Equipment Yard" — two of them, in
  fact, one with the cost code 24002 and one with none — and they were drawn in
  the Projects tab as ordinary sites. They hold no tools, so they were two empty
  cards padding the project list with somewhere nobody is working.

  MATCHED BY NAME, which is the weak part and is called out rather than hidden:
  nothing on `project` marks it as the department's own, so a rename or a third
  "Equipment Yard 2" walks straight past this. The durable fix is a column on
  the project — a kind, or a link to `department` — and until that exists this
  is one function so there is exactly one place to change.
*/
const YARD_PROJECT_NAME = "equipment yard";
function isYardProject(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === YARD_PROJECT_NAME;
}
const NOJOB = "__nojob";

/* The two cards that are NOT jobs carry a tint, because there the colour says
   something — this pile is the yard, this one is people between jobs. Jobs
   themselves are the default and get no wash: they were all tinted the same
   primary, which made twenty-six identical strips and told you nothing. */
const CARD_TINT: Record<string, string> = {
  [NOJOB]: "bg-accent/40",
};

export default function JobsitesPage() {
  const employees = trpc.employee.list.useQuery();
  const assets = trpc.asset.list.useQuery();
  const projects = trpc.project.list.useQuery();
  const vehicles = trpc.vehicle.list.useQuery();
  /* The project roster (pm/superintendent/foreman per job), for the team strip
     on each card. Loaded once, keyed by project — see projectTeam.all. */
  const team = trpc.projectTeam.all.useQuery();
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
  /* Team strip: PM/super assignment is roster-only and each carries its own
     permission (projectTeam.ts PERM_FOR_ROLE). */
  const canAssignPm = has("project.assign.pm");
  const canAssignSuper = has("project.assign.superintendent");

  const { projectIds: scope } = useJobScope();

  /* ---- filters: one bar, everything searchable ---- */
  const [q, setQ] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [foremanFilter, setForemanFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [highValueOnly, setHighValueOnly] = useState(false);
  /* Was a single "no truck or trailer" toggle, which answered neither question
     on its own: a crew with no truck cannot haul anything, a crew with no
     trailer can still carry tools in the bed. They are different problems and
     the desk chases them separately. */
  const [gapFilter, setGapFilter] = useState<"" | "no_crew" | "no_truck" | "no_trailer">("");
  /* Blocky concept delta: job-level sort. Crews already sort by name; the
     cards themselves had no ordering, which left the yard reading in whatever
     order the projects happened to arrive in. Sort keys come from the Blocky
     board (tools, value, gaps, name). */
  const [cardSort, setCardSort] = useState<"tools" | "value" | "gaps" | "name">("tools");
  /* Blocky concept delta: the Projects / In Yard split. The design's board
     split into a Projects tab and an In Yard tab; the In Yard view here is the
     yard and the project-less groups, which the page ALREADY renders as cards —
     this toggle just narrows the list to those cards instead of re-querying. */
  /*
    Renamed from `view` on 2026-08-23. The merge that brought the Blocky concept
    onto main landed a SECOND `const [view, setView]` in this same function —
    one for the render style ("cards" | "blocky", declared above) and this one
    for the content filter ("jobs" | "pool"). Two const bindings of one name in
    one scope is not a conflict TypeScript can shrug at: `pnpm typecheck` failed
    on main from that merge onward, and since next.config.mjs does not ignore
    build errors, the production image could not be built either. The two states
    are independent features that simply chose the same name, so telling them
    apart is the whole fix.
  */
  const [poolView, setPoolView] = useState<"jobs" | "pool">("jobs");
  /*
     How the cards are DRAWN — the detailed list (default) or the compact grid
     whose tools open in a right sheet. Distinct from `poolView` above, which
     picks WHICH cards exist; the two compose. Named `renderView` — the comment
     on `poolView` records the merge break a bare `view` binding caused here
     once already.

     Per-browser, like column widths: a presentation preference, not data.
     Starts as "list" and reads storage in an effect so the server HTML and the
     first client render agree (the nav-pins pattern) — which also means e2e
     runs, which start with clean storage, always land on the list view the
     jobsites specs measure.
  */
  const [renderView, setRenderView] = useState<"list" | "cards">("list");
  useEffect(() => {
    try {
      if (localStorage.getItem("sti-jobsites-view") === "cards") setRenderView("cards");
    } catch {
      /* Never break rendering over a cache. */
    }
  }, []);
  const pickRenderView = (v: "list" | "cards") => {
    setRenderView(v);
    try {
      localStorage.setItem("sti-jobsites-view", v);
    } catch {
      /* Quota / private mode — the choice just does not stick. */
    }
  };
  const [openJobs, setOpenJobs] = useState<Record<string, boolean>>({});
  const [openCrews, setOpenCrews] = useState<Record<string, boolean>>({});
  /*
    The master expand/collapse, as four clicks over three states.

    Two things were wrong with the boolean this replaces.

    It could not WIN. Per-card state lived in `openJobs`, and the read was
    `collapseAll ? (openJobs[id] ?? false) : (openJobs[id] ?? true)` — a
    default, not an override. So the master only ever moved cards nobody had
    touched: open one job by hand and that card ignored "Collapse all" for the
    rest of the session, which reads as a broken button rather than as a
    subtle precedence rule. Each master click now CLEARS the per-card maps, so
    it always applies to everything and per-card toggles resume from there.

    And it could not reach the state people actually wanted. Jobs and crews
    are two levels (STI-401: a job with nine crews should show nine crews, not
    nine tool tables), and one boolean cannot say "open the jobs but leave the
    crews shut". The step below is the level being addressed:

      0  jobs open, crews shut     — the default, and what STI-401 chose
      1  jobs open, crews open     — everything visible
      2  jobs open, crews shut     — back to the overview, jobs still open
      3  everything shut           — the whole list as headers

    Step 2 repeats step 0's state deliberately: coming back from "all crews
    open" should land on the overview, not skip to a fully collapsed list.
    That is why four clicks cycle three states.
  */
  const [expandStep, setExpandStep] = useState(0);
  const MASTER_STEPS = [
    { jobs: true, crews: false, next: "Expand crews" },
    { jobs: true, crews: true, next: "Collapse crews" },
    { jobs: true, crews: false, next: "Collapse all" },
    { jobs: false, crews: false, next: "Expand all" },
  ] as const;
  const master = MASTER_STEPS[expandStep]!;
  /* Clearing both maps is the whole fix for "the main button does nothing
     after I touch a card". */
  const stepMaster = () => {
    setExpandStep((i) => (i + 1) % MASTER_STEPS.length);
    setOpenJobs({});
    setOpenCrews({});
  };
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [assign, setAssign] = useState<CrewAssignRequest | null>(null);
  /* Loose tools ticked on a card's "nobody holding" section, per card. */
  const [selectedLoose, setSelectedLoose] = useState<Record<string, Set<string>>>({});

  const anyFilter = !!(
    q.trim() ||
    jobFilter ||
    foremanFilter ||
    statusFilter ||
    categoryFilter ||
    highValueOnly ||
    gapFilter
  );
  const clearFilters = () => {
    setQ("");
    setJobFilter("");
    setForemanFilter("");
    setStatusFilter("");
    setCategoryFilter("");
    setHighValueOnly(false);
    setGapFilter("");
  };
  /* Everything narrowing the card list except the free-text search, which has
     its own box in the bar. */
  const sheetFilterCount = [jobFilter, foremanFilter, statusFilter, categoryFilter, gapFilter].filter(
    Boolean,
  ).length + (highValueOnly ? 1 : 0);

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

  /* Every tool-level filter in one predicate. The status check used to be
     repeated inline at each of the four places tools are gathered (crew, loose,
     yard, project-less), which is three chances to forget the next filter. */
  const toolOk = (t: ToolRow) =>
    (!statusFilter || t.status === statusFilter) &&
    (!categoryFilter || (t.categoryName ?? "") === categoryFilter) &&
    (!highValueOnly || isHighValue(t));

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
      fullyRigged: number;
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
            toolOk(t),
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

      /* Roster foremen who hold no tools yet. A freshly invited or freshly
         assigned foreman has nothing for moveEmployeeToProject to move until
         somebody hands them something, so `byForeman` — built entirely from
         tool custody — never sees them: "on the project" and "shows up on
         Tools by Jobsite" silently disagreed. Same card, empty rig and tool
         list, so the person is visible and ready to receive a hand-off
         instead of invisible until their first one. */
      const rosterForemen = (team.data?.find((t) => t.projectId === projectId)?.members ?? []).filter(
        (m) => m.role === "foreman" && !byForeman.has(m.employeeId),
      );
      for (const m of rosterForemen) {
        if (foremanFilter && m.employeeId !== foremanFilter) continue;
        if (!(jobHit || hit(`${m.name ?? ""} ${m.externalId ?? ""}`))) continue;
        const rig = rigOf(m.employeeId, vehicles.data ?? []);
        crews.push({
          id: `${projectId}:${m.employeeId}`,
          foremanId: m.employeeId,
          foremanExternalId: m.externalId ?? null,
          foremanName: m.name ?? "Unknown",
          foremanRole: m.employeeRole ?? "",
          rig,
          tools: [],
          otherJobs: new Set(
            tools.filter((t) => t.custodianId === m.employeeId && t.currentProjectId && t.currentProjectId !== projectId).map((t) => t.currentProjectId),
          ).size,
        });
      }
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
          toolOk(t),
      );
      const toolCount = crews.reduce((n, c) => n + c.tools.length, 0) + loose.length;
      const value =
        crews.reduce((n, c) => n + c.tools.reduce((m, t) => m + (Number(t.acquisitionCost) || 0), 0), 0) +
        loose.reduce((n, t) => n + (Number(t.acquisitionCost) || 0), 0);
      const noTruck = crews.filter((c) => !c.rig.truck).length;
      const gaps = crews.length === 0 ? ["no crew"] : noTruck ? [`${noTruck} crew${noTruck === 1 ? "" : "s"} without a truck`] : [];
      out.push({
        id: p.id,
        name: p.name,
        code: p.externalId,
        isJob: true,
        crews,
        loose,
        toolCount,
        value,
        gaps,
        /* No tint: the job header gets its band from the render site's
           fallback (bg-muted/40) rather than a coloured wash. The card
           already carries an icon chip, the gap pill and the crew list; a
           primary wash behind all of it was the third use of the same hue in
           one strip. The special (yard / between jobs) cards tint differently
           because there the colour says what kind of pile this is. */
        tint: "",
        fullyRigged: crews.filter((c) => c.rig.truck && c.rig.trailer).length,
      });
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
            toolOk(t),
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
          toolOk(t),
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
        fullyRigged: 0,
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
        fullyRigged: noJobCrews.filter((c) => c.rig.truck && c.rig.trailer).length,
      });
    }

    return out.filter((c) => {
      /* The Equipment Yard is NOT a job — neither the synthetic yard card nor
         the real project(s) Urban names that way. Both belong in the In Yard
         tab, and are excluded from Projects below. */

      const isYard = c.id === YARD || isYardProject(c.name);
      /* The Equipment Yard is not a job. It shows ONLY in the In Yard tab, so a
         desk scanning the projects list never has to page past a place nobody
         is working to read the sites that are. */
      if (poolView === "jobs" && isYard) return false;

      /* Pool view shows the unassigned groups only — the yard, the yard
         projects, and the project-less people. Projects drop out entirely, but
         NOJOB keeps its pinned-bottom rule below. */
      if (poolView === "pool" && !isYard && c.id !== NOJOB) return false;
      /* The not-assigned group is pinned at the bottom permanently — it must
         survive filters that prune everything else. */
      if (c.id === NOJOB) return true;
      if (gapFilter === "no_crew" && c.crews.length) return false;
      if (gapFilter === "no_truck" && !c.crews.some((x) => !x.rig.truck)) return false;
      if (gapFilter === "no_trailer" && !c.crews.some((x) => !x.rig.trailer)) return false;
      /*
        A card filtered down to nothing is noise, not information — but a
        text search and the browsing filters (status/category/gap) disagree
        on what "nothing" means, and conflating them was the bug.

        `crews.length` counts every foreman ON THE PROJECT, built before any
        filter runs (buildCrews always pushes a crew, even one whose `tools`
        the filter emptied out) — so it stays non-zero for almost any staffed
        job regardless of what was typed. That is exactly the right thing to
        lean on for status/category/gap: "this crew has nobody matching THIS
        filter, but they're real people on a real job" is worth keeping
        visible. It is exactly the wrong thing for a text search: typing a
        tag or a serial and getting back every staffed job on the board,
        holding none of it, is the "everything is shown" a foreman actually
        hit searching for one tool by its code.

        So a non-empty search drops a toolless card outright UNLESS the job's
        own name or code is what matched (`hit` against `c.name`/`c.code`,
        the same predicate `jobHit` used above) — a newly awarded job with
        zero tools yet is still the right answer to searching its own name.
        Every other filter keeps the old, more forgiving rule.
      */
      if (c.toolCount === 0) {
        if (q.trim() && !hit(`${c.name} ${c.code ?? ""}`)) return false;
        if (anyFilter && c.crews.length === 0) return false;
      }
      return true;
    }).sort((a, b) => {
      /* Two pinned tails, in order: the yard sits below every job, and the
         project-less people sit below the yard. Both are answers to "what is
         NOT on a job", and neither should ever out-rank a job on tool count —
         the yard holds more tools than any single site by definition, so
         sorting it by the same key put the warehouse at the top of a board
         about job sites. Checked before the sort keys so no key can reorder
         them. */
      if (a.id === NOJOB) return 1;
      if (b.id === NOJOB) return -1;
      const aYard = a.id === YARD || isYardProject(a.name);
      const bYard = b.id === YARD || isYardProject(b.name);
      if (aYard !== bYard) return aYard ? 1 : -1;
      if (cardSort === "name") return a.name.localeCompare(b.name);
      if (cardSort === "gaps") return b.gaps.length - a.gaps.length || b.toolCount - a.toolCount;
      if (cardSort === "value") return b.value - a.value || b.toolCount - a.toolCount;
      return b.toolCount - a.toolCount || a.name.localeCompare(b.name);
    });
  }, [assets.data, projects.data, foremen, allCustodians, vehicles.data, team.data, scope, q, jobFilter, foremanFilter, statusFilter, categoryFilter, highValueOnly, gapFilter, anyFilter, cardSort, poolView]);

  /*
    What the Pool holds, read off the cards it is about to draw.

    Derived from `cards` rather than recounted from `assets`, so the label can
    never disagree with the two cards underneath it — a summary that survives a
    filter its own contents did not is worse than no summary.
  */
  const poolCounts = useMemo(
    () => ({
      yard: cards.find((c) => c.id === YARD)?.toolCount ?? 0,
      noJob: cards.find((c) => c.id === NOJOB)?.toolCount ?? 0,
    }),
    [cards],
  );

  /* Categories actually present in the register, so the filter never offers a
     choice that returns nothing. */
  const categoryOptions = useMemo(
    () =>
      [...new Set((assets.data ?? []).map((a) => a.categoryName).filter((c): c is string => !!c))].sort(),
    [assets.data],
  );

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
    <div className="flex flex-col gap-6">
      <RigPicker request={picker} onClose={() => setPicker(null)} onDone={invalidate} foremen={foremen} vehicles={vehicles.data ?? []} projects={projects.data ?? []} />
      <CrewAssignDialog
        request={assign}
        onClose={() => setAssign(null)}
        onDone={() => {
          setSelectedLoose({});
          invalidate();
        }}
      />

      <div className="flex min-w-0 flex-col gap-3">
          <>
          {/* Carded on `bg-card`, same as every other search/filter bar: the
              toolbar is a control strip, so it sits on the surface controls
              are drawn on rather than floating on the page background. The
              one bar that used to be carded and the ones that were bare are
              now the same treatment. */}
          <section className="flex flex-col gap-2 rounded-md border bg-card p-2">
            {/* Search stays on the bar because it is the one control used on
                every visit. The other six live in the sheet — as loose
                dropdowns they wrapped to one per line the moment the window
                narrowed, turning the filter bar into a column taller than the
                first card. */}
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
              <FilterSheet
                title="Filter jobsites"
                activeCount={sheetFilterCount}
                onApply={() => {}}
                onClear={clearFilters}
              >
                <FilterField label="Job">
                  <SearchSelect
                    value={jobFilter}
                    onChange={setJobFilter}
                    placeholder="All jobs"
                    widthClass="w-full"
                    options={[
                      ...(projects.data ?? []).map((p) => ({
                        value: p.id,
                        label: p.externalId ? `${p.externalId} · ${p.name}` : p.name,
                      })),
                      { value: YARD, label: "URB-YARD · Equipment Yard" },
                      { value: NOJOB, label: "Not assigned to any project" },
                    ]}
                  />
                </FilterField>
                <FilterField label="Foreman">
                  <SearchSelect
                    value={foremanFilter}
                    onChange={setForemanFilter}
                    placeholder="All foremen"
                    widthClass="w-full"
                    options={foremen.map((f) => ({
                      value: f.id,
                      label: f.externalId ? `${f.externalId} · ${f.name}` : f.name,
                    }))}
                  />
                </FilterField>
                <FilterField label="Tool status">
                  <SearchSelect
                    value={statusFilter}
                    onChange={setStatusFilter}
                    placeholder="Any status"
                    widthClass="w-full"
                    options={["assigned", "available", "in_maintenance", "lost"].map((s) => ({
                      value: s,
                      label: humanize(s),
                    }))}
                  />
                </FilterField>
                <FilterField label="Tool category">
                  <SearchSelect
                    value={categoryFilter}
                    onChange={setCategoryFilter}
                    placeholder="Any category"
                    widthClass="w-full"
                    options={categoryOptions.map((c) => ({ value: c, label: c }))}
                  />
                </FilterField>
                <FilterField label="Rig gap">
                  <SearchSelect
                    value={gapFilter}
                    onChange={(v) => setGapFilter(v as typeof gapFilter)}
                    placeholder="Any rig"
                    widthClass="w-full"
                    options={[
                      { value: "no_crew", label: "Job with no crew" },
                      { value: "no_truck", label: "Crew without a truck" },
                      { value: "no_trailer", label: "Crew without a trailer" },
                    ]}
                  />
                </FilterField>
                <Button
                  variant={highValueOnly ? "secondary" : "outline"}
                  size="sm"
                  className="justify-start"
                  onClick={() => setHighValueOnly((v) => !v)}
                  aria-pressed={highValueOnly}
                >
                  <TriangleAlert className="size-3.5" /> High-value tools only
                </Button>
              </FilterSheet>
            </div>

            {/* What is currently narrowing the list, each removable on its own —
                otherwise a filter set in the sheet is invisible once it closes. */}
            <FilterPills
              pills={[
                ...(jobFilter
                  ? [{
                      key: "job",
                      label:
                        jobFilter === YARD
                          ? "Equipment Yard"
                          : jobFilter === NOJOB
                            ? "Not assigned"
                            : (projects.data ?? []).find((p) => p.id === jobFilter)?.name ?? "Job",
                      onRemove: () => setJobFilter(""),
                    }]
                  : []),
                ...(foremanFilter
                  ? [{
                      key: "foreman",
                      label: foremen.find((f) => f.id === foremanFilter)?.name ?? "Foreman",
                      onRemove: () => setForemanFilter(""),
                    }]
                  : []),
                ...(statusFilter
                  ? [{ key: "status", label: humanize(statusFilter), onRemove: () => setStatusFilter("") }]
                  : []),
                ...(categoryFilter
                  ? [{ key: "category", label: categoryFilter, onRemove: () => setCategoryFilter("") }]
                  : []),
                ...(gapFilter
                  ? [{
                      key: "gap",
                      label:
                        gapFilter === "no_crew"
                          ? "No crew"
                          : gapFilter === "no_truck"
                            ? "No truck"
                            : "No trailer",
                      onRemove: () => setGapFilter(""),
                    }]
                  : []),
                ...(highValueOnly
                  ? [{ key: "high", label: "High value", onRemove: () => setHighValueOnly(false) }]
                  : []),
              ]}
            />
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {/* The whole card-row summary in one line — the numbers that used
                  to sit in metric cards above, where they only pushed the cards
                  themselves below the fold. */}
              <span className="tnum font-mono">
                {shownTools} tool{shownTools === 1 ? "" : "s"} · {shownCrews} crew{shownCrews === 1 ? "" : "s"} · {cards.length} card{cards.length === 1 ? "" : "s"}
              </span>
              {/* The count is also the way in: seeing that eleven crews cannot
                  haul anything and then having to open the sheet to find them
                  is a dead end where a link belongs. */}
              {crewsWithoutTruck ? (
                /* The button that clears it ("Clear filters") is a `Button`
                   ghost — this chip is the same control family and is now one
                   too, not a raw `<button>` styled to look like its sibling. */
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn("tnum h-6 rounded-full px-2 text-warn", gapFilter === "no_truck" && "bg-warn-bg")}
                  onClick={() => setGapFilter(gapFilter === "no_truck" ? "" : "no_truck")}
                  aria-pressed={gapFilter === "no_truck"}
                >
                  {crewsWithoutTruck} without a truck
                </Button>
              ) : null}
              {anyFilter ? (
                <Button variant="ghost" size="sm" className="h-6 rounded-full px-2 text-primary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
              {/* What the Pool actually holds, said in numbers.

                  Only in the In Yard tab: on Projects it would be describing cards that
                  are not on screen. The two figures are the two cards below it,
                  so the label is a summary of the view rather than a statistic
                  from somewhere else. */}
              {poolView === "pool" ? (
                <span className="text-xs text-muted-foreground">
                  <span className="tnum font-medium text-foreground">{poolCounts.yard}</span> in the yard
                  {" · "}
                  <span className="tnum font-medium text-foreground">{poolCounts.noJob}</span> held with no job
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                {/* List or compact cards. Same segmented pattern as Projects/In
                    Yard beside it — text, not icons, so the two controls read as
                    siblings rather than one of them looking like a toolbar. */}
                <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Layout">
                  {([["list", "List"], ["cards", "Cards"]] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => pickRenderView(key)}
                      aria-pressed={renderView === key}
                      className={cn(
                        "min-w-[4.5rem] px-4 py-1.5 text-xs transition-colors",
                        renderView === key
                          ? "bg-muted font-medium text-foreground"
                          : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Projects / In Yard split. "Jobs" named a thing this tab is
                    only partly about (a job is a site; this is also where
                    unassigned-foreman crews sit), and "Pool" was jargon. The
                    two labels say what each tab actually is. */}
                <div className="flex overflow-hidden rounded-md border" role="group" aria-label="View">
                  {([["jobs", "Projects"], ["pool", "In Yard"]] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPoolView(key)}
                      aria-pressed={poolView === key}
                      className={cn(
                        /* Wide enough to read as two tabs. At `px-2.5` the pair
                           was narrower than the sort control beside it and read
                           as one small chip rather than a choice. */
                        "min-w-[4.5rem] px-4 py-1.5 text-xs transition-colors",
                        poolView === key
                          ? "bg-muted font-medium text-foreground"
                          : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Blocky concept delta: job-level sort. The one control the
                    design's board adds that the page did not have. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5" aria-label="Sort jobs">
                      <ArrowDownWideNarrow className="size-3.5" />
                      {cardSort === "tools" ? "Most tools" : cardSort === "value" ? "Most value" : cardSort === "gaps" ? "Most gaps" : "Name"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setCardSort("tools")}>Most tools</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setCardSort("value")}>Most value</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setCardSort("gaps")}>Most gaps</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setCardSort("name")}>Name</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {renderView === "list" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={stepMaster}
                  title="Steps through: jobs open, crews open, crews shut, everything shut"
                >
                  {master.next === "Expand all" || master.next === "Expand crews" ? (
                    <Eye className="size-3.5" />
                  ) : (
                    <ChevronDown className={cn("size-3.5", master.next === "Collapse all" && "rotate-180")} />
                  )}
                  {master.next}
                </Button>
                ) : null}
              </div>
            </div>
          </section>

          {!cards.length ? (
            <EmptyState icon={Building2} title="Nothing matches those filters" description="Clear a filter, or search for a different unit." />
          ) : null}

          {renderView === "cards" ? (
            /* The same `cards` array the list maps over — both views are one
               derivation with two layouts, so a filter, the scope selector or
               the Projects/In Yard split can never show different worlds in the
               two modes.
               The icon is chosen HERE because this file owns the YARD/NOJOB
               sentinels; the card view rendering them would mean the string
               literals living in two files. */
            <JobsiteCardView
              cards={cards.map((c) => ({
                ...c,
                icon: c.id === NOJOB ? Users : c.id === YARD ? Warehouse : Building2,
              }))}
              canAct={canActTools}
              highlight={q}
              onPick={setPicker}
              onAssignRequest={setAssign}
              canManage={canDrive}
              canAssignCrew={canAssignCrew}
              canAssignTools={canAssignTools}
              team={team.data ?? []}
              employees={employees.data ?? []}
              canAssignPm={canAssignPm}
              canAssignSuper={canAssignSuper}
            />
          ) : (
          cards.map((card) => {
            const open = openJobs[card.id] ?? master.jobs;
            /* Each card kind has its own icon: jobs are sites, the yard is the
               warehouse, the project-less people are a crew waiting for work. */
            const CardIcon = card.id === NOJOB ? Users : card.id === YARD ? Warehouse : Building2;

            /* The team strip for this job: its roster rows from projectTeam.all
               (only for jobs — the yard and the project-less group have no PM
               or superintendent), plus the candidate PMs/supers for the add
               menus, restricted to active employees. */
            const roster = card.isJob
              ? team.data?.find((t) => t.projectId === card.id)?.members ?? []
              : [];
            const teamLeaders = roster.filter(
              (m): m is (typeof roster)[number] & { role: "pm" | "superintendent" } =>
                m.role === "pm" || m.role === "superintendent",
            );
            const teamCandidates = (employees.data ?? [])
              .filter((e) => e.employmentStatus === "active")
              .map((e) => ({ id: e.id, name: e.name, externalId: e.externalId, employeeRole: e.role }));
            /*
              The edge bar marks a card out, so it only renders when there is
              something to mark.

              It shipped on every job in the accent colour, which meant a column
              of identical stripes down the whole page — the same hue, on every
              card, saying nothing. A signal that never varies is decoration,
              and it competed with the one bar that did mean something. Now:
              amber for a job with NO CREW (nobody can work it), a muted bar for
              the two cards that are not jobs at all, and nothing for a job that
              is simply running normally.
              Whole class strings because Tailwind scans source text.
            */
            const edge = !card.isJob
              ? "before:bg-muted-foreground/40"
              : card.crews.length === 0
                ? "before:bg-warn"
                : null;
            return (
              <section
                key={card.id}
                className={cn(
                  "relative overflow-visible rounded-md border bg-card",
                  edge && "pl-[3px] before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
                  edge,
                )}
              >
                <header
                  className={cn(
                    /* Slim list header, per the design: the icon chip, the
                       name, the counts. Normal jobs carry a faint wash so the
                       project row reads as the outer level of the nested
                       layout — the foreman boxes that open below are white
                       cards on the tinted body, and the header is the band
                       they hang from. The special (yard / between jobs) cards
                       keep their stronger tints — there the colour says what
                       kind of pile this is. */
                    "flex flex-wrap items-center gap-2 px-2.5 py-2",
                    card.tint || "bg-muted/40",
                  )}
                >
                  {/* Expand / collapse at the FRONT, beside the foreman
                      chevrons that open under it — the desk clicks down the
                      left edge, and a project toggle stranded at the far right
                      would cost a mouse trip across every card. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="order-first -ml-1 size-8 shrink-0"
                    aria-label={open ? `Collapse ${card.name}` : `Expand ${card.name}`}
                    aria-expanded={open}
                    onClick={() => setOpenJobs((o) => ({ ...o, [card.id]: !open }))}
                  >
                    <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
                  </Button>
                  {/* The chip identifies the KIND of card (job / yard / between jobs). That
                      is not a state, so it does not take the accent — with the
                      edge bar right beside it, an accent chip made the same point
                      twice in 12px. */}
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted/70 text-muted-foreground">
                    <CardIcon className="size-4.5" aria-hidden />
                  </span>
                  <span className="flex min-w-40 flex-1 flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold tracking-tight">
                      <Highlight text={card.name} q={q} />
                    </span>
                    {card.code ? (
                      <span className="tnum rounded-sm border bg-muted/60 px-2 py-0.5 font-mono text-sm text-foreground/75">
                        {card.isJob ? <span className="text-muted-foreground">JOB </span> : null}
                        {card.code}
                      </span>
                    ) : null}
                    <span className="text-sm text-muted-foreground">
                      {card.isJob ? (card.crews.length ? `${card.crews.length} crew${card.crews.length === 1 ? "" : "s"}` : "no crew yet") : "between jobs"}
                    </span>
                    {card.gaps.length ? (
                      <span className="flex items-center gap-1.5 rounded-sm border border-warn/30 bg-warn-bg px-2 py-1 text-[13px] font-medium text-warn">
                        <TriangleAlert className="size-3.5" aria-hidden /> {card.gaps.join(" · ")}
                      </span>
                    ) : null}
                    {card.isJob ? (
                      <JobsiteTeamStrip
                        projectId={card.id}
                        members={teamLeaders}
                        candidates={teamCandidates}
                        canAssignPm={canAssignPm}
                        canAssignSuper={canAssignSuper}
                      />
                    ) : null}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-right whitespace-nowrap">
                      <span className="block rounded-sm border bg-muted/50 px-2.5 py-1 text-[13px]">
                        <span className="tnum text-sm font-semibold text-foreground">{card.toolCount}</span> tool{card.toolCount === 1 ? "" : "s"}
                      </span>
                      <span className="tnum mt-1 block font-mono text-[13px] text-muted-foreground">{moneyShort(card.value)}</span>
                    </span>
                    {card.isJob && canAssignCrew ? (
                      <Button variant="outline" size="sm" className="border-dashed border-muted-foreground/40 text-primary hover:border-primary/50" onClick={() => setPicker({ kind: "crew", projectId: card.id })}>
                        <Plus className="size-3.5" /> Add crew
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <ActionMenuTrigger label={card.name} className="size-8" />
                      <DropdownMenuContent>
                        {card.isJob && canAssignCrew ? (
                          <DropdownMenuItem onSelect={() => setPicker({ kind: "crew", projectId: card.id })}>Add a foreman and truck/trailer</DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onSelect={() => setOpenJobs((o) => ({ ...o, [card.id]: !open }))}>
                          {open ? "Collapse" : "Expand"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </header>

                {open ? (
                  /* One bordered container per foreman, nested inside the job
                     card — the design's two-level shape, not a flat register.
                     The body carries a faint wash so the white crew boxes read
                     as cards ON it, not as one more flat surface; each crew
                     box has its own header row and the tool table opens under
                     it (folded to five rows + "Show more" inside ToolTable).
                     The loose section keeps its tinted band below as its own
                     row under the crew list. */
                  <div className="border-t border-border bg-muted/10">
                    <div className="flex flex-col gap-2 p-2">
                      {card.crews.length ? (
                        card.crews.map((crew) => (
                          <CrewCard
                            key={crew.id}
                            crew={crew}
                            /* STI-401: jobs open, CREWS CLOSED by default, which
                               is `master.crews` at step 0. Urban runs ~28 crews,
                               so expanding every crew's tool table turned the
                               department's morning question ("who needs a
                               vehicle") into a scroll. A crew the desk opens stays
                               open via `openCrews` until the master steps, which
                               clears the map so it can address every crew at once
                               — the second level the old boolean could not reach. */
                            expanded={openCrews[crew.id] ?? master.crews}
                            onToggle={() => setOpenCrews((o) => ({ ...o, [crew.id]: !(o[crew.id] ?? master.crews) }))}
                            onPick={setPicker}
                            onAddTools={
                              canAssignTools
                                ? () => setAssign({ mode: "pickTools", foremanId: crew.foremanId, foremanName: crew.foremanName })
                                : undefined
                            }
                            canManage={canDrive}
                            canAct={canActTools}
                            highlight={q}
                            projectId={card.id}
                          />
                        ))
                      ) : card.isJob && canAssignCrew ? (
                        <div className="p-3">
                          <button
                            type="button"
                            onClick={() => setPicker({ kind: "crew", projectId: card.id })}
                            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-muted-foreground/40 px-4 py-4 text-left text-sm font-medium text-primary hover:border-primary/50"
                          >
                            <Plus className="size-4" aria-hidden /> No crew on this job yet — add a foreman with a truck or trailer.
                          </button>
                        </div>
                      ) : card.id === NOJOB ? (
                        <p className="px-4 py-3 text-sm text-muted-foreground">
                          Every foreman is on a project right now — this group holds whoever is between jobs.
                        </p>
                      ) : null}
                    </div>
                      {card.loose.length ? (
                        <div className="px-2 pb-2">
                          <LooseSection
                            isJob={card.isJob}
                            rows={card.loose}
                            selected={selectedLoose[card.id] ?? new Set<string>()}
                            canAssign={canAssignTools}
                            canAct={canActTools}
                            highlight={q}
                            flush
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
                        </div>
                      ) : null}
                    </div>
                ) : null}
              </section>
            );
          })
          )}
          </>
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
  flush = false,
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
  /* The connected-row list layout: no own box or rounding — the card's body
     container and the divide rule above it do that. Kept a flag rather than
     restyled unconditionally so the sheet/card surfaces can carry the boxed
     variant as long as they want it. */
  flush?: boolean;
  onToggle: (assetId: string) => void;
  onAssign: () => void;
  onClear: () => void;
}) {
  const n = selected.size;
  const SectionIcon = isJob ? PackageOpen : Package;
  return (
    /* The whole block takes its own tint so unassigned tools read differently
       from the foreman crew cards around them. */
    <div
      className={cn(
        isJob ? "border-primary/15 bg-primary/5" : "border-muted/60 bg-muted/10",
        flush ? "" : "overflow-hidden rounded-md border",
      )}
    >
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
          /* `h-6` on the SLOT, not a min-height on the header.

             The row is sized by its tallest child. Empty, that was a text line;
             with a selection it became an `h-6` button, so ticking a checkbox
             grew the header 8px and shunted the table down — measured, not
             guessed. Reserving on the header instead was tried and left 1px,
             because `border-box` counts the `border-b` inside a `min-h-*` while
             the button state adds it on top. Sizing the slot that actually
             varies has no such arithmetic: the tallest child is 24px whether or
             not anything is in it.

             The rule this is an instance of: space for a control that comes and
             goes is RESERVED, never created on arrival. */
          <span className="ml-auto flex h-6 items-center gap-1.5">
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
