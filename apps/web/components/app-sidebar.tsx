"use client";

import Link from "next/link";
import { ChevronsUpDown, FolderKanban, LogOut, UserRound } from "lucide-react";
import { useJobScope } from "@/components/job-scope";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { navFor, type NavGroup } from "@/components/sti/nav-config";
import { cn } from "@/lib/utils";

/*
  The app sidebar, reshaped on the shadcn dashboard-01 skeleton:

    header — the brand
    content — the role's navigation groups
    footer — the account menu, which also carries the job selection (which
             projects this person can see) and the job-group manager

  Collapses to icons on a desk layout, folds into a sheet on a phone — both
  behaviours come from the shared Sidebar primitive.
*/

export function AppSidebar({
  userRole,
  permissions,
  inboxCount,
  userName,
  onSignOut,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  userRole: string | null;
  permissions: string[];
  inboxCount: number;
  userName: string;
  onSignOut: () => void;
}) {
  const groups = navFor(userRole);
  /* Which jobs the signed-in user may see — the account menu's Jobs section. */
  const { groups: jobGroups, selectedGroup, setSelectedGroup } = useJobScope();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="data-[slot=sidebar-menu-button]:p-2!">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-[11px] font-bold text-sidebar-primary-foreground">
                ST
              </div>
              <span className="truncate text-base font-semibold">STInventory</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSeparator />
      </SidebarHeader>

      <SidebarContent>
        {groups.map((g: NavGroup) => {
          const visible = g.items.filter((n) => !n.perm || permissions.includes(n.perm));
          if (!visible.length) return null;
          return (
            <SidebarGroup key={g.label}>
              <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
              <SidebarMenu>
                {visible.map((n) => (
                  <SidebarMenuItem key={n.href}>
                    <SidebarMenuButton asChild tooltip={n.label}>
                      <Link href={n.href}>
                        <n.icon className="size-4 shrink-0" />
                        <span className="truncate">{n.label}</span>
                        {n.href === "/inbox" && inboxCount > 0 ? (
                          <SidebarMenuBadge>{inboxCount > 99 ? "99+" : inboxCount}</SidebarMenuBadge>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <div className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                    {userName
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </div>
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{userName}</span>
                    <span className="truncate text-xs text-sidebar-foreground/60">
                      {userRole?.replace(/_/g, " ") ?? "—"}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 shrink-0 text-sidebar-foreground/50" aria-hidden />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="end"
                sideOffset={4}
                className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
              >
                <DropdownMenuLabel>{userName}</DropdownMenuLabel>
                <DropdownMenuSeparator />

                {/* Jobs — the system-wide project selection, tucked under the
                    account menu instead of cluttering the rail. Hidden for a
                    user with no group assignments (they see everything). */}
                {jobGroups.length > 0 ? (
                  <>
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Jobs</DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={() => setSelectedGroup("")}
                      className={cn(!selectedGroup && "bg-accent text-accent-foreground")}
                    >
                      <FolderKanban className="size-4" aria-hidden />
                      All projects
                      <span className="tnum ml-auto text-xs text-muted-foreground">
                        {jobGroups.reduce((n, g) => n + g.projects.length, 0)}
                      </span>
                    </DropdownMenuItem>
                    {jobGroups.map((g) => (
                      <DropdownMenuItem
                        key={g.id}
                        onSelect={() => setSelectedGroup(g.id)}
                        className={cn(selectedGroup === g.id && "bg-accent text-accent-foreground")}
                      >
                        <span className="min-w-0 flex-1 truncate">{g.name}</span>
                        <span className="tnum text-xs text-muted-foreground">{g.projects.length}</span>
                      </DropdownMenuItem>
                    ))}
                    {permissions.includes("project.manage") ? (
                      <DropdownMenuItem asChild>
                        <Link href="/job-groups">
                          <FolderKanban className="size-4" aria-hidden />
                          Manage job groups
                        </Link>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                  </>
                ) : null}

                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <UserRound className="size-4" aria-hidden />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem variant="danger" onSelect={onSignOut}>
                  <LogOut className="size-4" aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
