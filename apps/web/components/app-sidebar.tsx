"use client";

import Link from "next/link";
import { ProjectSwitcher } from "@/components/project-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { navFor, type NavGroup } from "@/components/sti/nav-config";

/*
  The app sidebar on the shadcn sidebar-07 skeleton:

    header — the system-wide job selector
    content — the role's navigation
    no footer — identity lives in the top bar's account menu

  Collapses to icons on a desk layout and folds into a sheet on a phone.
*/

export function AppSidebar({
  userRole,
  permissions,
  inboxCount,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  userRole: string | null;
  permissions: string[];
  inboxCount: number;
}) {
  const groups = navFor(userRole);

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* h-14 and a border, matching the top bar exactly: the job selector and
          the page title sit on the same baseline and the two borders read as
          one rule across the shell instead of a step. */}
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border p-2">
        <ProjectSwitcher />
      </SidebarHeader>

      <SidebarContent className="overscroll-contain pb-2">
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

      <SidebarRail />
    </Sidebar>
  );
}
