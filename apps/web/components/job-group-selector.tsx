"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, FolderKanban } from "lucide-react";
import { useJobScope } from "@/components/job-scope";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/*
  The job selector at the top of the sidebar — the account-selector pattern
  from shadcn, but for job groups instead of accounts.

  Hidden entirely for a user with no group assignments (they see the whole
  tenant, so there is nothing to choose). For a scoped user it shows the
  current selection and drops a menu: "All my jobs" or one specific group,
  each with its job count.
*/

export function JobGroupSelector() {
  const { groups, selectedGroup, setSelectedGroup, loading } = useJobScope();
  const [label, setLabel] = useState("All my jobs");

  useEffect(() => {
    if (selectedGroup) {
      setLabel(groups.find((g) => g.id === selectedGroup)?.name ?? "All my jobs");
    } else {
      setLabel("All my jobs");
    }
  }, [groups, selectedGroup]);

  /* No assignments means no scoping — nothing to offer. */
  if (loading || !groups.length) return null;

  return (
    <div className="px-3 pb-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-2 text-sm transition-colors hover:bg-sidebar-accent/70"
            aria-label="Choose which jobs to view"
          >
            <FolderKanban className="size-4 shrink-0 text-sidebar-foreground/70" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left font-medium">{label}</span>
            <span className="tnum shrink-0 text-xs text-sidebar-foreground/50">
              {selectedGroup
                ? (groups.find((g) => g.id === selectedGroup)?.projects.length ?? 0)
                : groups.reduce((n, g) => n + g.projects.length, 0)}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/50" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="w-64">
          <DropdownMenuLabel>Jobs</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => setSelectedGroup("")}
            className={cn(!selectedGroup && "bg-accent text-accent-foreground")}
          >
            <span className="flex w-full items-center justify-between gap-2">
              All my jobs
              <span className="tnum text-xs text-muted-foreground">
                {groups.reduce((n, g) => n + g.projects.length, 0)}
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {groups.map((g) => (
            <DropdownMenuItem
              key={g.id}
              onSelect={() => setSelectedGroup(g.id)}
              className={cn(selectedGroup === g.id && "bg-accent text-accent-foreground")}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="min-w-0 truncate">{g.name}</span>
                <span className="tnum text-xs text-muted-foreground">{g.projects.length}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
