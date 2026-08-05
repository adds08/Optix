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
import { cn } from "@/lib/utils";

/*
  The system-wide job selector, at the top of the sidebar.

  A dropdown with two kinds of option: "Show All" (the whole tenant — the
  toggle that clears the scope) and the job groups the signed-in user belongs
  to. Picking a group applies that scope everywhere — the register, the desk,
  jobsites, foremen, projects and custody all filter down together.

  A user with no group assignments sees nothing (they already see all jobs).
*/

export function ProjectSwitcher() {
  const { groups, selectedGroup, setSelectedGroup, loading } = useJobScope();
  const [label, setLabel] = useState("Show All");
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (selectedGroup) {
      const g = groups.find((x) => x.id === selectedGroup);
      setLabel(g?.name ?? "Show All");
      setCount(g?.projects.length ?? 0);
    } else {
      setLabel("Show All");
      setCount(groups.reduce((n, g) => n + g.projects.length, 0));
    }
  }, [groups, selectedGroup]);

  /* No assignments means nothing to scope — the whole tenant is already it. */
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
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Jobs you can see
            </DropdownMenuLabel>

            {/* Show All — the toggle that lifts the scope. */}
            <DropdownMenuItem
              onSelect={() => setSelectedGroup("")}
              className={cn(!selectedGroup && "bg-accent text-accent-foreground")}
            >
              <span className={cn("grid size-4 place-items-center", selectedGroup && "opacity-0")}>
                <Check className="size-3.5" aria-hidden />
              </span>
              Show All
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
                <span
                  className={cn(
                    "grid size-4 place-items-center",
                    selectedGroup !== g.id && "opacity-0",
                  )}
                >
                  <Check className="size-3.5" aria-hidden />
                </span>
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
