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
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { navFor, type NavGroup } from "@/components/sti/nav-config";

/*
  The app sidebar, reshaped on the shadcn dashboard-01 skeleton:

    header — the system-wide job selector (Show All / job groups)
    content — the role's navigation groups

  There is deliberately no footer: identity and profile already live in the
  top bar's account menu, so the rail stays pure navigation. The selector at
  the head is how a scoped superintendent picks which jobs they are looking
  at — that choice applies everywhere.
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
    </Sidebar>
  );
}
