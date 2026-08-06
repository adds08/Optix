"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, ChevronsUpDown, FolderKanban, Pencil, Plus, Search } from "lucide-react";
import { useJobScope } from "@/components/job-scope";
import { usePermissions } from "@/components/use-permissions";
import { JobGroupModal, type JobGroupEditable } from "@/components/job-group-modal";
import { trpc } from "@/lib/trpc";
import { useIsMobile } from "@/hooks/use-mobile";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { idName } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  The system-wide job selector, at the top of the rail.

  Two panes in ONE panel, not a menu of nested items — 10-50 jobs do not fit in
  a flat list you scroll past to reach the groups:

    left   scopes  — "All your projects" (a permanent, un-editable group) and
                     the user's job groups; searchable by group name
    right  jobs    — the jobs inside the highlighted scope, with its own job
                     search, a "show all in this scope" row, and per-job rows

  Picking anything applies everywhere at once (useJobScope). Editing a group's
  membership is the pencil in the right pane's header, which opens the same
  create/edit modal the Job Groups page uses.

  On a phone the two panes become one column with back navigation, because a
  side-by-side pane at 390px is a horizontal scroll waiting to happen.
*/

type Pane = { kind: "all" } | { kind: "group"; id: string } | null;

export function ProjectSwitcher() {
  const { has } = usePermissions();
  const isMobile = useIsMobile();
  const {
    groups,
    projects,
    selectedGroup,
    setSelectedGroup,
    selectedProject,
    setSelectedProject,
    loading,
  } = useJobScope();

  const [open, setOpen] = useState(false);
  /* On a desk the right pane is never empty — All your projects opens with it. */
  const [pane, setPane] = useState<Pane>({ kind: "all" });
  const [groupQuery, setGroupQuery] = useState("");
  const [jobQuery, setJobQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<JobGroupEditable | null>(null);

  /* Managers can edit any group, so the modal needs the full row (with its
     users); `mine` carries jobs only. */
  const all = trpc.projectGroup.list.useQuery(undefined, {
    enabled: open && has("project.manage"),
    retry: false,
  });

  const showAll = !selectedGroup && !selectedProject;
  const label = selectedProject
    ? idName(
        projects.find((p) => p.id === selectedProject)?.externalId ?? null,
        projects.find((p) => p.id === selectedProject)?.name ?? null,
      )
    : selectedGroup
      ? groups.find((g) => g.id === selectedGroup)?.name ?? "All your projects"
      : "All your projects";
  const count = selectedProject
    ? 1
    : selectedGroup
      ? groups.find((g) => g.id === selectedGroup)?.projects.length ?? 0
      : projects.length;

  const visibleGroups = useMemo(() => {
    const q = groupQuery.trim().toLowerCase();
    return q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;
  }, [groups, groupQuery]);

  const paneGroup = pane?.kind === "group" ? groups.find((g) => g.id === pane.id) ?? null : null;
  const paneJobs = useMemo(() => {
    const source = pane?.kind === "all" ? projects : paneGroup?.projects ?? [];
    const q = jobQuery.trim().toLowerCase();
    if (!q) return source;
    return source.filter((p) => `${p.externalId ?? ""} ${p.name}`.toLowerCase().includes(q));
  }, [pane, paneGroup, projects, jobQuery]);

  const close = () => {
    setOpen(false);
    setGroupQuery("");
    setJobQuery("");
    setPane(isMobile ? null : { kind: "all" });
  };

  const pickScope = (groupId: string) => {
    setSelectedGroup(groupId);
    close();
  };
  const pickAll = () => {
    setSelectedGroup("");
    setSelectedProject("");
    close();
  };
  const pickJob = (id: string) => {
    setSelectedProject(id);
    close();
  };

  const openPane = (next: Pane) => {
    setPane(next);
    setJobQuery("");
  };

  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
    close();
  };
  const openEdit = () => {
    if (!paneGroup) return;
    const full = (all.data ?? []).find((g) => g.id === paneGroup.id);
    setEditing({
      id: paneGroup.id,
      name: paneGroup.name,
      description: paneGroup.description,
      projectIds: paneGroup.projects.map((p) => p.id),
      userIds: (full?.users ?? []).map((u) => u.id),
    });
    setModalOpen(true);
    close();
  };

  if (loading) return null;

  const paneOpen = pane !== null;
  const paneTitle = pane?.kind === "all" ? "All your projects" : paneGroup?.name ?? "";
  const paneTotal = pane?.kind === "all" ? projects.length : paneGroup?.projects.length ?? 0;
  const paneScopeActive =
    pane?.kind === "all" ? showAll : !!paneGroup && selectedGroup === paneGroup.id && !selectedProject;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <JobGroupModal open={modalOpen} onClose={() => setModalOpen(false)} edit={editing} />

        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (o) setPane(isMobile ? null : { kind: "all" });
            else close();
          }}
        >
          <PopoverTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[slot=sidebar-menu-button]:p-2!">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <FolderKanban className="size-4" aria-hidden />
              </div>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{label}</span>
                <span className="truncate text-xs text-sidebar-foreground/60">
                  {count} job{count === 1 ? "" : "s"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 text-sidebar-foreground/50" aria-hidden />
            </SidebarMenuButton>
          </PopoverTrigger>

          <PopoverContent
            className={cn("flex p-0", isMobile ? "h-[70vh] w-[calc(100vw-2rem)] flex-col" : "h-100")}
          >
            {/* ---------- left pane: the scopes ---------- */}
            {(!isMobile || !paneOpen) && (
              <div className={cn("flex min-w-0 flex-col", isMobile ? "flex-1" : "w-68")}>
                <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
                  <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <Input
                    value={groupQuery}
                    onChange={(e) => setGroupQuery(e.target.value)}
                    placeholder="Search groups…"
                    className="h-auto border-0 p-0 shadow-none focus-visible:ring-0"
                  />
                </div>

                <div className="flex-1 overflow-y-auto p-1">
                  <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Jobs
                  </p>
                  <Row
                    active={showAll}
                    highlighted={pane?.kind === "all"}
                    onClick={() => openPane({ kind: "all" })}
                    trailing={
                      <>
                        <span className="tnum text-xs text-muted-foreground">{projects.length}</span>
                        <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
                      </>
                    }
                  >
                    <span className="truncate font-medium">All your projects</span>
                  </Row>

                  <p className="px-2 pb-1.5 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Job groups
                  </p>
                  {visibleGroups.length === 0 ? (
                    <p className="px-2 pb-1.5 text-sm text-muted-foreground">
                      {groups.length === 0 ? "No job groups yet — create one below." : "No group matches your search."}
                    </p>
                  ) : (
                    visibleGroups.map((g) => (
                      <Row
                        key={g.id}
                        active={selectedGroup === g.id && !selectedProject}
                        highlighted={pane?.kind === "group" && pane.id === g.id}
                        onClick={() => openPane({ kind: "group", id: g.id })}
                        trailing={
                          <>
                            <span className="tnum text-xs text-muted-foreground">{g.projects.length}</span>
                            <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
                          </>
                        }
                      >
                        <span className="truncate font-medium">{g.name}</span>
                      </Row>
                    ))
                  )}
                </div>

                {has("project.manage") ? (
                  <div className="shrink-0 border-t p-1">
                    <button
                      type="button"
                      onClick={openNew}
                      className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-sm font-medium text-primary hover:bg-accent"
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Create new group
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            {/* ---------- right pane: the jobs in that scope ---------- */}
            {paneOpen ? (
              <div className={cn("flex min-w-0 flex-col", isMobile ? "flex-1" : "w-72 border-l")}>
                <div className="flex h-10 shrink-0 items-center gap-2 border-b pl-3 pr-1">
                  {isMobile ? (
                    <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2" onClick={() => openPane(null)}>
                      <ChevronRight className="size-4 rotate-180" aria-hidden />
                      Back
                    </Button>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{paneTitle}</span>
                  <span className="tnum text-xs text-muted-foreground">{paneTotal}</span>
                  {paneGroup && has("project.manage") ? (
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7 shrink-0"
                      onClick={openEdit}
                      aria-label={`Edit ${paneGroup.name}`}
                      title="Edit group"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </Button>
                  ) : null}
                </div>

                <div className="flex h-9.5 shrink-0 items-center gap-2 border-b px-3">
                  <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <Input
                    value={jobQuery}
                    onChange={(e) => setJobQuery(e.target.value)}
                    placeholder="Search jobs…"
                    className="h-auto border-0 p-0 shadow-none focus-visible:ring-0"
                  />
                </div>

                <div className="flex-1 overflow-y-auto p-1">
                  <Row
                    active={paneScopeActive}
                    onClick={() => (pane?.kind === "all" ? pickAll() : paneGroup && pickScope(paneGroup.id))}
                  >
                    <span className="truncate font-medium">
                      {pane?.kind === "all" ? "Show all projects" : "Show all in this group"}
                    </span>
                  </Row>

                  <p className="px-2 pb-1.5 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Individual jobs
                  </p>
                  {paneJobs.length === 0 ? (
                    <p className="px-2 text-sm text-muted-foreground">
                      {jobQuery ? `No jobs match “${jobQuery}”.` : "No jobs in this group yet."}
                    </p>
                  ) : (
                    paneJobs.map((p) => (
                      <Row key={p.id} active={selectedProject === p.id} onClick={() => pickJob(p.id)}>
                        <span className="truncate">{idName(p.externalId, p.name)}</span>
                      </Row>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/* One selectable line. `active` is "this is the current scope" (the check);
   `highlighted` is only "this is the pane you are looking at". */
function Row({
  active,
  highlighted,
  onClick,
  trailing,
  children,
}: {
  active?: boolean;
  highlighted?: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
        (active || highlighted) && "bg-accent text-accent-foreground",
      )}
    >
      <span className={cn("grid size-3.5 shrink-0 place-items-center text-primary", !active && "opacity-0")}>
        <Check className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  );
}
