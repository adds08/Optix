"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { branchEmployeeIds, removalBranch } from "@stinventory/domain/project-branch";
import { suggestTierName } from "@stinventory/domain/role-suggestion";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityField } from "@/components/ui/entity-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { ProjectTeamsChart } from "@/components/project-teams-chart";
import { cn } from "@/lib/utils";
import { ChevronRight, ListTree, Network, Search, UserPlus, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { personHint, projectHint } from "@/lib/format";

export function ProjectTeamsPanel({ onboarding = false, onlyMine = false }: { onboarding?: boolean; onlyMine?: boolean }) {
  const utils = trpc.useUtils();
  const query = trpc.projectTeams.workspace.useQuery();
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"person" | "branch" | "reporting" | "remove" | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [tier, setTier] = useState("");
  const [parentId, setParentId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [reason, setReason] = useState("");
  const [moveTools, setMoveTools] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const projects = query.data?.projects ?? [];
  /*
    PEOPLE, AS OPTIONS SOMEBODY CAN TELL APART.

    These pickers offered `label: p.name` and nothing else. On Urban's register
    that is 1,851 rows of repeated names — the reason the dropdown was reported
    as broken when it scrolls perfectly well and simply had nothing to
    distinguish one row from the next.

    Two changes, both cheap:
      * the job title and employee code ride along as the picker's `hint`,
        which `EntityField` renders AND searches, so typing a code now finds
        somebody.
      * the viewer's own direct reports sort to the top. A superintendent
        staffing a job is nearly always adding their own crew, and HR's manager
        edge already knows who those are — 1,851/1,851 people are reachable in
        that graph, with no cycles.

    A suggestion about ORDER only. Everybody eligible is still in the list, and
    nothing here decides who may be added — `assertCanAssign` does that on the
    write.
  */
  const viewerId = query.data?.viewerEmployeeId ?? null;
  const personOptions = useMemo(() => {
    const all = query.data?.people ?? [];
    const decorated = all.map(p => ({
      value: p.id,
      label: p.name,
      hint: personHint(p),
      mine: !!viewerId && p.reportsToEmployeeId === viewerId,
    }));
    return decorated.sort((a, b) =>
      a.mine === b.mine ? a.label.localeCompare(b.label) : a.mine ? -1 : 1,
    );
  }, [query.data?.people, viewerId]);

  const project = projects.find(p => p.id === projectId);
  /*
    Pre-select the tier from the chosen person's job title — "Foreman -
    Flatworks" opens on Foreman. Overridable, and null for the long tail of
    titles that say nothing about a tier (`Carpenter`, `Curb Man`), which
    leaves the picker exactly as it was.

    A title is NOT a tier: the same superintendent is a superintendent on one
    job and nothing on seventeen others, and Urban's own data has a
    `Superintendent` reporting to six different titles. This only saves a
    click on the common case — the human still chooses.
  */
  /*
    EVERY TIER, with the ones you cannot set DISABLED and told why.

    They used to be filtered out entirely, so a Director opening this saw two
    tiers and no Foreman — which reads as a broken dropdown, and was reported as
    one. An omission cannot explain itself; a disabled row can.

    The reason names the tiers that CAN set it, which is the actionable half:
    "ask a Superintendent" is something a person can act on, "you may not" is
    not. Built from `setBy`, returned per tier by `projectTeams.workspace`.
  */
  const tierOptions = useMemo(() => {
    const all = query.data?.tiers ?? [];
    return all.map(t => {
      const allowed = project?.assignable.includes(t.name) ?? false;
      const setters = (t.setBy ?? []).filter(n => n !== t.name);
      return {
        value: t.name,
        label: t.label,
        disabled: !allowed,
        hint: allowed
          ? undefined
          : setters.length
            ? `Set by ${setters.join(", ")}`
            : "Nobody on this job can set this tier yet",
      };
    });
  }, [query.data?.tiers, project?.assignable]);

  const suggestedTier = useMemo(() => {
    const person = (query.data?.people ?? []).find(p => p.id === employeeId);
    const allowed = (query.data?.tiers ?? []).filter(t => project?.assignable.includes(t.name));
    return suggestTierName(person?.jobTitle, allowed);
  }, [employeeId, query.data?.people, query.data?.tiers, project?.assignable]);
  useEffect(() => { if (!projectId && projects.length) { const requested = new URLSearchParams(window.location.search).get("projectId"); setProjectId(projects.some(p => p.id === requested) ? requested! : projects[0]!.id); } }, [query.data, projectId]);
  /*
    Branches the reader has folded away, by employee id.

    Session-only and NOT persisted: a collapse is a working note about the crew
    in front of you right now, the same reasoning the register uses for a
    pinned row. Collapsed by id rather than by roster-row id so a person folded
    on one job stays folded if they appear on another.
  */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (employeeId: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  const visible = useMemo(() => {
    if (!project) return [];
    let members = project.members;
    if (onlyMine && query.data?.viewerEmployeeId && !query.data.isDesk) {
      const ids = branchEmployeeIds(members, project.id, query.data.viewerEmployeeId);
      members = members.filter(m => ids.has(m.employeeId));
    }
    /*
      Walk the branch, carrying the two facts a TREE needs that a flat list does
      not: how many people answer to this person, and whether they are the last
      child of their parent. Without `isLast` the elbow connectors cannot be
      drawn, and the rows read as an indented list rather than a chart — which
      is exactly how it looked before.
    */
    const searching = search.trim().length > 0;
    const childCount = new Map<string, number>();
    for (const m of members) {
      if (!m.reportsToEmployeeId) continue;
      childCount.set(m.reportsToEmployeeId, (childCount.get(m.reportsToEmployeeId) ?? 0) + 1);
    }
    const sorted: { member: typeof members[number]; depth: number; isLast: boolean; reports: number }[] = [];
    const seen = new Set<string>();
    const walk = (parent: string | null, depth: number) => {
      const kids = members.filter(m => m.reportsToEmployeeId === parent).sort((a,b) => a.name.localeCompare(b.name));
      kids.forEach((m, i) => {
        if (seen.has(m.id)) return;
        seen.add(m.id);
        sorted.push({ member: m, depth, isLast: i === kids.length - 1, reports: childCount.get(m.employeeId) ?? 0 });
        /* A folded branch is not walked, so its descendants never enter the
           list — the count on the row says how many are hidden.

           SEARCH OVERRIDES THE FOLD. Typing a name that sits inside a
           collapsed branch would otherwise return nothing, and the reader has
           no way to know their own fold is what hid it — the worst kind of
           empty result. While a search is running every branch is walked. */
        if (searching || !collapsed.has(m.employeeId)) walk(m.employeeId, depth + 1);
      });
    };
    walk(null, 0);
    /* Anybody the walk did not reach — their manager is not on this job, or the
       edge points at somebody removed. They are roots of their own, not hidden. */
    /* Anybody the walk did not reach — their manager is not on this job, or the
       edge points at somebody removed. They are roots of their own, not hidden.

       The fold is honoured here too: without the guard a collapsed person's
       reports were unreachable from the main walk, fell into this loop, and
       reappeared as top-level rows — so collapsing hid nothing and moved
       everything instead. */
    for (const m of members) {
      if (seen.has(m.id)) continue;
      /* Hidden if ANY ancestor is folded, not just the immediate manager —
         collapsing a director must hide their superintendents' foremen too.
         Walks up the chain, cycle-safe via `hops`. */
      if (!searching) {
        const byEmployee = new Map(members.map(x => [x.employeeId, x]));
        let at = m.reportsToEmployeeId, hops = 0, hidden = false;
        while (at && hops++ < members.length) {
          if (collapsed.has(at)) { hidden = true; break; }
          at = byEmployee.get(at)?.reportsToEmployeeId ?? null;
        }
        if (hidden) { seen.add(m.id); continue; }
      }
      seen.add(m.id);
      sorted.push({ member: m, depth: 0, isLast: true, reports: childCount.get(m.employeeId) ?? 0 });
      if (searching || !collapsed.has(m.employeeId)) walk(m.employeeId, 1);
    }
    return sorted.filter(({ member: m }) => `${m.name} ${m.label}`.toLowerCase().includes(search.toLowerCase()));
  }, [project, search, onlyMine, query.data, collapsed]);
  /* List or chart. Session-only and per-screen: which shape you want depends
     on what you are doing right now — scanning and editing wants the list,
     "what does this crew look like" wants the chart — not on a preference
     worth persisting. */
  const [view, setView] = useState<"list" | "chart">("list");
  const source = projects.find(p => p.id === sourceId);
  const selectedBranch = source && employeeId ? source.members.filter(m => branchEmployeeIds(source.members, source.id, employeeId).has(m.employeeId)) : [];
  const removal = project && employeeId ? removalBranch(project.members, project.id, employeeId).members : [];
  const open = (next: typeof mode) => { setMode(next); setEmployeeId(""); setTier(""); setSourceId(""); setMemberId(""); setParentId(query.data?.isDesk ? "" : query.data?.viewerEmployeeId ?? ""); setError(""); setReason(""); setMoveTools(true); };
  /*
    "Add someone under THIS person" — the same dialog, opened with the manager
    already chosen.

    Adding to a crew is nearly always adding beneath somebody specific, and the
    generic button made you pick that person again from a list of everybody on
    the job. Seeding `parentId` turns a three-field form into a two-field one
    and removes the commonest way to get a branch wrong.
  */
  const addUnder = (employeeIdOfManager: string) => { open("person"); setParentId(employeeIdOfManager); };
  const refresh = async () => { await Promise.all([query.refetch(), utils.projectTeam.invalidate(), utils.onboarding.invalidate(), utils.project.list.invalidate(), utils.asset.list.invalidate()]); };
  const submit = async () => {
    if (!project || !mode) return;
    setBusy(true); setError("");
    try {
      if (mode === "person") await utils.client.projectTeam.assign.mutate({ projectId, employeeId, role: tier, reportsToEmployeeId: parentId || null, moveTools, source: "manual_entry" });
      if (mode === "branch") await utils.client.projectTeams.assignBranch.mutate({ projectId, sourceProjectId: sourceId, employeeId, reportsToEmployeeId: parentId || null, moveTools });
      if (mode === "reporting") await utils.client.projectTeam.setReportsTo.mutate({ id: memberId, reportsToEmployeeId: parentId || null });
      if (mode === "remove") await utils.client.projectTeams.removeBranch.mutate({ projectId, employeeId, reason });
      await refresh(); setMode(null); toast.success("Project team updated");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this team."); }
    finally { setBusy(false); }
  };
  if (query.isLoading) return <TableSkeleton />;
  if (query.error) return <ErrorNote message={query.error.message} />;
  return <div className="space-y-5">
    {!onboarding && <div><h1 className="text-2xl font-semibold">{onlyMine ? "My Crew" : "Project Teams"}</h1><p className="mt-1 text-sm text-muted-foreground">The full reporting branch, from project leadership to the people doing the work. Changes here also appear in onboarding.</p></div>}
    {!projects.length ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No project team is assigned yet. Your administrator or manager can connect your team. You can finish your personal setup while they arrange it.</p> : <>
      {/*
        NOT a 50/50 grid. The two controls answer different-sized questions —
        "which job" is the one you change, "find someone in it" is occasional —
        and giving them equal halves made the toolbar read as two peers with no
        hierarchy. The picker leads; search takes the remaining room and only
        appears once a crew is long enough to need scanning.
      */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="sm:w-72">
          <EntityField value={projectId} onChange={setProjectId} options={projects.map(p => ({ value: p.id, label: p.name, hint: projectHint(p) }))} placeholder="Choose project" searchPlaceholder="Search projects" emptyLabel="No projects" />
        </div>
        {(project?.members.length ?? 0) > 4 && (
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search team" placeholder="Find someone on this job…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
          </div>
        )}
      </div>
      {project && <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {/*
          THE HEADER CARRIES IDENTITY AND VIEW, NOT EVERY ACTION.

          It used to hold four buttons in a row — View tools, Add existing
          branch, Add person, plus the list/chart pair — beside a grey strip
          with the job number in it. Nothing was emphasised, so nothing read as
          the thing you came to do, and the card looked like a toolbar with some
          rows underneath.

          Now: the job number is a Tag (the same treatment the register gives a
          tool code), the count is a plain fact beside it, and the header keeps
          only the VIEW control — which is about the header's own content. The
          actions move down to where the crew is, so "Add person" sits next to
          the thing it adds to. See the action bar below the list.
        */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {project.code && <Tag>{project.code}</Tag>}
              <h2 className="truncate font-semibold">{project.name}</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {project.members.length === 0
                ? "Nobody on this job yet"
                : `${project.members.length} ${project.members.length === 1 ? "person" : "people"} on this job`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          {/* A segmented pair rather than two loose buttons, so it reads as one
              control with two states — the same shape the register's density
              toggle uses. Hidden on an empty crew: there is nothing to draw. */}
          {project.members.length > 0 && (
            <div className="flex items-center rounded-md border p-0.5" role="group" aria-label="View">
              {(["list", "chart"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-xs font-medium capitalize transition-colors",
                    view === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v === "list" ? <ListTree className="size-3.5" aria-hidden /> : <Network className="size-3.5" aria-hidden />}
                  {v}
                </button>
              ))}
            </div>
          )}
          </div>
        </header>
        {!visible.length ? (
          /* An empty crew is the NORMAL state of a job somebody just took on,
             not a page that failed — so it carries the action rather than a
             grey sentence telling you to look elsewhere for it. A search that
             matches nothing is a different thing and says so. */
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span aria-hidden className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <UsersRound className="size-5" />
            </span>
            <div>
              <p className="font-medium">{search ? "No match on this job" : "Nobody on this job yet"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {search
                  ? `Nothing here matches “${search}”.`
                  : "Add the people who run it. Everyone you add can then staff the tiers below them."}
              </p>
            </div>
            {!search && project.assignable.length > 0 && (
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => open("person")}><UserPlus className="size-4" aria-hidden />Add person</Button>
                <Button size="sm" variant="outline" onClick={() => open("branch")}>Add existing branch</Button>
              </div>
            )}
          </div>
        ) : view === "chart" ? (
          /* The chart draws the SEARCH-FILTERED set too, so typing a name
             narrows both views identically rather than one silently ignoring
             the box above it. */
          <ProjectTeamsChart rows={visible.map(({ member }) => member)} />
        ) : <ul className="divide-y">{visible.map(({ member: m, depth, isLast, reports }) => (
          /*
            A ROW THAT SHOWS THE SHAPE.

            This was a flat list with 14px of margin per level and a faint left
            border, plus the words "Reports to X" — so the hierarchy was carried
            entirely by a sentence, and four tiers looked like four siblings.

            Now the indent is drawn: a rail per ancestor level and an elbow into
            each row, the treatment a file tree uses, so who sits under whom is
            legible without reading. `isLast` is what lets the elbow close
            rather than run past the final child.
          */
          <li key={m.id} className={cn(
            /* py-1.5, not py-3. Every row carried a 32px avatar, a name line, a
                 caption line and 24px of padding — about 76px each, so nine
                 people filled a screen. The register's own rows are ~36px and
                 this is the same kind of list.

                 flex-wrap (not sm:flex-row forcing one line): a row with three
                 action buttons plus a long name, title and tier pill had
                 nowhere to put all of it on one line past a modest width, and
                 the buttons ended up drawn on top of the truncated text
                 instead of pushed below it. Wrapping lets the action group
                 drop to its own line under the person's details rather than
                 overlapping them. */
            "group relative flex flex-wrap items-center gap-2 px-3 py-1.5 transition-colors hover:bg-muted/40",
            /* The top of a branch is the one row you orient from, so it gets a
               tint and a spine down its left edge. Everything below hangs off
               it visually as well as logically. */
            depth === 0 && "bg-primary/[0.03] before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary/40",
          )}>
            <div className="flex min-w-0 basis-full items-stretch sm:basis-0 sm:flex-1">
              {/* The rails. One per ancestor level, then a NODE — the person's
                  initials sitting on the connector rather than beside it, so
                  the branch reads as an org chart laid on its side instead of
                  an indented list with a decoration.

                  Purely visual: the caption below still names the manager in
                  words, which is what a screen reader follows. */}
              {Array.from({ length: depth }).map((_, i) => (
                <span key={i} aria-hidden className="relative w-6 shrink-0">
                  {/* 2px, not 1px. A hairline connector disappears against the
                      row divider at any real viewing distance — the indent
                      still read as an indent rather than as a drawn branch.
                      `bg-border` is also lightened for dividers; these are
                      structure, so they take a stronger tint. */}
                  {i < depth - 1 ? (
                    <span className="absolute inset-y-0 left-2.5 w-0.5 rounded-full bg-primary/25" />
                  ) : (
                    <>
                      <span className={cn("absolute left-2.5 top-0 w-0.5 rounded-full bg-primary/25", isLast ? "h-1/2" : "inset-y-0")} />
                      {/* The elbow reaches the node and is rounded at the end,
                          so the corner reads as a turn rather than a crop. */}
                      <span className="absolute left-2.5 top-1/2 h-0.5 w-3.5 rounded-full bg-primary/25" />
                    </>
                  )}
                </span>
              ))}

              {/* The node itself. Tinted by whether anybody answers to this
                  person — a manager and a leaf are different kinds of row, and
                  colour says so faster than counting reports. */}
              <span
                aria-hidden
                className={cn(
                  "mr-2.5 flex size-7 shrink-0 items-center justify-center self-center rounded-full border text-[10px] font-semibold tracking-tight",
                  reports > 0
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {m.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?"}
              </span>

              {/* THE FOLD. Only where there is something to fold — a leaf gets
                  a matching spacer so every name still starts on one column. */}
              {reports > 0 ? (
                <button
                  type="button"
                  onClick={() => toggleCollapse(m.employeeId)}
                  aria-expanded={!collapsed.has(m.employeeId)}
                  aria-label={collapsed.has(m.employeeId) ? `Show ${reports} under ${m.name}` : `Hide ${reports} under ${m.name}`}
                  className="mr-1 flex size-5 shrink-0 items-center justify-center self-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronRight className={cn("size-3.5 transition-transform", !collapsed.has(m.employeeId) && "rotate-90")} />
                </button>
              ) : (
                <span aria-hidden className="mr-1 size-5 shrink-0" />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Employee code leads, matching the People page's own
                      "Employee Code" column — that page puts it first, before
                      the name, and this row now agrees with it instead of
                      burying the code after the title in one combined hint. */}
                  {m.code && <Tag>{m.code}</Tag>}
                  <Link href={`/people/${m.employeeId}`} className="text-sm font-medium hover:underline">{m.name}</Link>
                  {/* Job title only here — the code already led the row above. */}
                  {m.jobTitle && (
                    <span className="truncate text-xs text-muted-foreground">{m.jobTitle}</span>
                  )}
                  <StatusPill tone={depth === 0 ? "info" : "idle"} label={m.label} />
                  {/* The span of control, where there is one. It is the fact
                      that makes a branch readable at a glance. */}
                  {reports > 0 && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {collapsed.has(m.employeeId) ? `+${reports} hidden` : `${reports} ${reports === 1 ? "report" : "reports"}`}
                    </span>
                  )}
                  {/*
                    ONE LINE, not two. "Reports to X" had its own row under
                    every name, which doubled the height of the list to repeat
                    what the rails already draw — the person above you IS your
                    manager, visibly.

                    So it only speaks when the drawing CANNOT: a manager who is
                    not on this job (nothing above the row to point at), or an
                    unrecorded one. Both are exceptions worth a word; the
                    ordinary case is silent.
                  */}
                  {m.reportsToEmployeeId && !query.data?.people.some(p => p.id === m.reportsToEmployeeId && project?.members.some(x => x.employeeId === p.id)) && (
                    <span className="text-[11px] text-muted-foreground">
                      reports to {query.data?.people.find(p => p.id === m.reportsToEmployeeId)?.name ?? "someone not on this job"}
                    </span>
                  )}
                  {!m.reportsToEmployeeId && depth > 0 && (
                    <span className="text-[11px] text-warn">manager not recorded</span>
                  )}
                </div>
              </div>
            </div>
            {/*
              QUIET UNTIL WANTED.

              Two filled buttons on every row is what made a nine-person crew
              read as a wall of controls — the actions shouted louder than the
              names, and the hierarchy the rails draw was lost behind them.

              They fade in on hover and on keyboard focus (`focus-within`, so
              tabbing still reaches them), and stay permanently visible on touch
              where there is no hover to reveal them. The same treatment the
              register's row menu already uses.

              And they are OUTLINED, not ghost. Ghost made all three read as
              plain text until hovered, which is why they did not look
              clickable at all. `h-7` with `text-xs` keeps them inside a row
              that is now half the height it was — the default button is 34px
              and would set the row's height on its own.
            */}
            {m.canManage && (
              <div className="ml-7 flex basis-full flex-wrap gap-1.5 opacity-100 transition-opacity sm:ml-0 sm:basis-auto sm:shrink-0 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                {/* The action you most often want from a row: put somebody
                    UNDER this person. Only where the tier register says
                    somebody can go below them. */}
                {project.assignable.length > 0 && (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => addUnder(m.employeeId)}>
                    <UserPlus className="size-3.5" aria-hidden />Add below
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { open("reporting"); setMemberId(m.id); setEmployeeId(m.employeeId); setParentId(m.reportsToEmployeeId ?? ""); }}>Change manager</Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive" onClick={() => { open("remove"); setEmployeeId(m.employeeId); }}>Remove</Button>
              </div>
            )}
          </li>
        ))}</ul>}
        {/*
          THE ACTION BAR, under the crew rather than in the header.

          "Add person" belongs next to the thing it adds to — at the bottom of
          the list, where your eye already is after reading it, and where the
          next row will appear. In the header it was one of four buttons
          competing for the same corner, so nothing read as primary.

          Hidden when the crew is empty: the empty state above carries the same
          two actions, and showing both would be the button twice on one card.
          "View tools" is a link out and sits apart from the two that write.
        */}
        {visible.length > 0 && (project.assignable.length > 0 || !onboarding) && (
          <footer className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-4 py-3">
            {project.assignable.length > 0 && (
              <>
                <Button size="sm" onClick={() => open("person")}><UserPlus className="size-4" aria-hidden />Add person</Button>
                <Button size="sm" variant="outline" onClick={() => open("branch")}>Add existing branch</Button>
              </>
            )}
            {!onboarding && (
              <Button asChild size="sm" variant="ghost" className="ml-auto text-muted-foreground">
                <Link href="/jobsites">View tools on this job</Link>
              </Button>
            )}
          </footer>
        )}
      </section>}
    </>}
    <Dialog open={!!mode} onOpenChange={open => { if (!open && !busy) setMode(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{mode === "person" ? "Add a person" : mode === "branch" ? "Add an existing branch" : mode === "reporting" ? "Change reporting manager" : "Remove branch access"}</DialogTitle></DialogHeader>
      {mode === "branch" && <label className="space-y-2 text-sm">From project<EntityField value={sourceId} onChange={id => { setSourceId(id); setEmployeeId(""); }} options={projects.filter(p => p.id !== projectId).map(p => ({ value: p.id, label: p.name, hint: projectHint(p) }))} placeholder="Choose source project" searchPlaceholder="Find project" emptyLabel="No other projects" /></label>}
      {(mode === "person" || mode === "branch") && <label className="space-y-2 text-sm">{mode === "branch" ? "Top of the branch" : "Person"}<EntityField value={employeeId} onChange={setEmployeeId} options={mode === "branch" ? (source?.members ?? []).filter(m => m.canManage).map(m => ({ value: m.employeeId, label: `${m.name} · ${m.label}` })) : personOptions} placeholder="Select person" searchPlaceholder="Search people" emptyLabel="No eligible people" /></label>}
      {mode === "person" && <label className="space-y-2 text-sm">Tier on this project<EntityField value={tier || suggestedTier || ""} onChange={setTier} options={tierOptions} placeholder="Choose tier" searchPlaceholder="Search tiers" emptyLabel="No assignment grants" /></label>}
      {mode !== "remove" && <label className="space-y-2 text-sm">Reports to<EntityField value={parentId} onChange={setParentId} options={[...(query.data?.isDesk ? [{ value: "", label: "Not recorded yet" }] : []), ...personOptions.filter(o => o.value !== employeeId && (query.data?.isDesk || o.value === viewerId || project?.members.some(m => m.employeeId === o.value && m.canManage)))]} placeholder="Choose reporting manager" searchPlaceholder="Search managers" emptyLabel="No manager found" /></label>}
      {mode === "branch" && selectedBranch.length > 0 && <div className="rounded-md bg-muted p-3 text-sm"><strong>Branch to add</strong><ul className="mt-2 space-y-1">{selectedBranch.map(m => <li key={m.id}>{m.name} · {m.label}</li>)}</ul></div>}
      {(mode === "branch" || mode === "person") && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={moveTools} onChange={e => setMoveTools(e.target.checked)} /><span>Move held tools with custody-holding members.<span className="block text-xs text-muted-foreground">When unchecked, directly held tools are released on their previous job. Custody-holding members move from their previous posting; other members can work on multiple projects.</span></span></label>}
      {mode === "remove" && <><p className="text-sm">Remove project access for this branch. Other projects and historical records remain. Outstanding tools must be returned or transferred first.</p><ul className="rounded-md bg-muted p-3 text-sm">{removal.map(m => <li key={m.id}>{m.name} · {m.label}</li>)}</ul><label className="space-y-2 text-sm">Reason<Input value={reason} onChange={e => setReason(e.target.value)} /></label></>}
      {error && <ErrorNote message={error} />}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setMode(null)}>Cancel</Button><Button disabled={busy || (mode === "remove" ? !reason.trim() : mode === "person" ? !employeeId || !tier : mode === "branch" ? !selectedBranch.length : !memberId)} onClick={submit}>{busy ? "Saving…" : mode === "remove" ? "Remove access" : "Save team"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
