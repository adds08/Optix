"use client";

import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { ProjectSwitcher } from "@/components/project-switcher";
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

/*
  The app sidebar, reshaped on the shadcn dashboard-01 skeleton:

    header — the system-wide project switcher
    content — the role's navigation groups
    footer — who is signed in, with sign out

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

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* The system-wide project selector lives at the very top of the rail. */}
      <SidebarHeader>
        <ProjectSwitcher />
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
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="end"
                sideOffset={4}
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              >
                <DropdownMenuLabel className="text-xs text-muted-foreground">Account</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <UserRound className="size-4" aria-hidden />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onSignOut}>
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
