"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, FolderKanban } from "lucide-react";
import { useJobScope } from "@/components/job-scope";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
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
  The system-wide job selector, at the top of the sidebar — the shadcn
  team-switcher pattern. Always visible:

    Show All     — the toggle that lifts any selection
    Job groups   — the user's groups, each with its jobs underneath
    Every job    — the flat ID - Name list when there are no groups

  Picking anything applies it everywhere at once.
*/

export function ProjectSwitcher() {
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
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
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
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
            align="start"
            side="bottom"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Jobs</DropdownMenuLabel>

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
                      <span className={cn("grid size-4 place-items-center", selectedGroup !== g.id && "opacity-0")}>
                        <Check className="size-3.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                      <span className="tnum text-xs text-muted-foreground">{g.projects.length}</span>
                    </DropdownMenuItem>
                    {g.projects.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onSelect={() => setSelectedProject(p.id)}
                        className={cn("pl-7", selectedProject === p.id && "bg-accent text-accent-foreground")}
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
                      <span className={cn("grid size-4 place-items-center", selectedProject !== p.id && "opacity-0")}>
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
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
