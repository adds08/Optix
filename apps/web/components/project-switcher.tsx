"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, FolderKanban } from "lucide-react";
import { useJobScope } from "@/components/job-scope";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { idName } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  The system-wide job selector — the dropdown at the very top of the sidebar,
  always visible.

  Options, in order:
    Show All     — the toggle that lifts any selection
    Job groups   — the groups the user belongs to, each with its jobs
                   underneath (grouping options)
    Every job    — the flat list, shown when the user has no groups

  Picking anything applies it everywhere: the register, jobsites, foremen,
  projects and custody all filter down together.
*/

export function ProjectSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { groups, projects, selectedGroup, setSelectedGroup, selectedProject, setSelectedProject, loading } =
    useJobScope();
  const [label, setLabel] = useState("Show All");
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (selectedProject) {
      const p = projects.find((x) => x.id === selectedProject);
      setLabel(p ? idName(p.externalId, p.name) : "Show All");
      setCount(1);
    } else if (selectedGroup) {
      const g = groups.find((x) => x.id === selectedGroup);
      setLabel(g?.name ?? "Show All");
      setCount(g?.projects.length ?? 0);
    } else {
      setLabel("Show All");
      setCount(groups.length ? groups.reduce((n, g) => n + g.projects.length, 0) : projects.length);
    }
  }, [groups, projects, selectedGroup, selectedProject]);

  if (loading) return null;

  const showAllActive = !selectedGroup && !selectedProject;

  return (
    <div className={cn("pt-2", collapsed ? "px-2" : "px-3")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-2 text-sm transition-colors hover:bg-sidebar-accent/70",
              collapsed && "justify-center px-0",
            )}
            aria-label="Choose which jobs to view"
            title={collapsed ? label : undefined}
          >
            <FolderKanban className="size-4 shrink-0 text-sidebar-foreground/70" aria-hidden />
            <span className={cn("min-w-0 flex-1 truncate text-left font-medium", collapsed && "hidden")}>
              {label}
            </span>
            <span className={cn("tnum shrink-0 text-xs text-sidebar-foreground/50", collapsed && "hidden")}>
              {count}
            </span>
            <ChevronsUpDown className={cn("size-3.5 shrink-0 text-sidebar-foreground/50", collapsed && "hidden")} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
          align="start"
          side="bottom"
          sideOffset={4}
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground">Jobs</DropdownMenuLabel>

          {/* Show All — the toggle that lifts the scope. */}
          <DropdownMenuItem
            onSelect={() => {
              setSelectedGroup("");
              setSelectedProject("");
            }}
            className={cn(showAllActive && "bg-accent text-accent-foreground")}
          >
            <span className={cn("grid size-4 place-items-center", !showAllActive && "opacity-0")}>
              <Check className="size-3.5" aria-hidden />
            </span>
            Show All
            <span className="tnum ml-auto text-xs text-muted-foreground">
              {groups.length ? groups.reduce((n, g) => n + g.projects.length, 0) : projects.length}
            </span>
          </DropdownMenuItem>

          {groups.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Job groups</DropdownMenuLabel>
              {groups.map((g) => (
                <div key={g.id}>
                  <DropdownMenuItem
                    onSelect={() => setSelectedGroup(g.id)}
                    className={cn(selectedGroup === g.id && "bg-accent text-accent-foreground")}
                  >
                    <span
                      className={cn("grid size-4 place-items-center", selectedGroup !== g.id && "opacity-0")}
                    >
                      <Check className="size-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                    <span className="tnum text-xs text-muted-foreground">{g.projects.length}</span>
                  </DropdownMenuItem>
                  {g.projects.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onSelect={() => setSelectedProject(p.id)}
                      className={cn(
                        "pl-7",
                        selectedProject === p.id && "bg-accent text-accent-foreground",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{idName(p.externalId, p.name)}</span>
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
            </>
          ) : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Every job</DropdownMenuLabel>
              <div className="max-h-72 overflow-y-auto">
                {projects.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={() => setSelectedProject(p.id)}
                    className={cn(selectedProject === p.id && "bg-accent text-accent-foreground")}
                  >
                    <span
                      className={cn(
                        "grid size-4 place-items-center",
                        selectedProject !== p.id && "opacity-0",
                      )}
                    >
                      <Check className="size-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{idName(p.externalId, p.name)}</span>
                  </DropdownMenuItem>
                ))}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
