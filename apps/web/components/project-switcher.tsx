"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, FolderKanban } from "lucide-react";
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
import { cn } from "@/lib/utils";

/*
  The system-wide project selector, in the sidebar header.

  The shadcn account-switcher pattern, applied to jobs: one control at the top
  of every screen that says which jobs you are looking at. "All projects" shows
  everything the user may see; picking a job group scopes the whole system to
  the jobs in it — the register, the desk, the jobsite view, foremen, projects
  and custody all filter down together.

  A user with no group assignments sees no switcher at all (they already see
  the whole tenant).
*/

export function ProjectSwitcher() {
  const { groups, selectedGroup, setSelectedGroup, loading } = useJobScope();
  const [label, setLabel] = useState("All projects");
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (selectedGroup) {
      const g = groups.find((x) => x.id === selectedGroup);
      setLabel(g?.name ?? "All projects");
      setCount(g?.projects.length ?? 0);
    } else {
      setLabel("All projects");
      setCount(groups.reduce((n, g) => n + g.projects.length, 0));
    }
  }, [groups, selectedGroup]);

  /* No assignments means nothing to switch between. */
  if (loading || !groups.length) return null;

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
                <span className="truncate text-xs text-sidebar-foreground/60">{count} jobs</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 text-sidebar-foreground/50" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side="bottom"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Jobs</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => setSelectedGroup("")}
              className={cn(!selectedGroup && "bg-accent text-accent-foreground")}
            >
              <FolderKanban className="size-4" aria-hidden />
              All projects
              <span className="tnum ml-auto text-xs text-muted-foreground">
                {groups.reduce((n, g) => n + g.projects.length, 0)}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {groups.map((g) => (
              <DropdownMenuItem
                key={g.id}
                onSelect={() => setSelectedGroup(g.id)}
                className={cn(selectedGroup === g.id && "bg-accent text-accent-foreground")}
              >
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <span className="tnum text-xs text-muted-foreground">{g.projects.length}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
