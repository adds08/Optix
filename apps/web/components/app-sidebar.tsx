"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProjectSwitcher } from "@/components/project-switcher";
import { cn } from "@/lib/utils";
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
import { navFor, type NavItem } from "@/components/sti/nav-config";

/*
  The secondary sidebar: the job scope selector at its head, then every group
  and its rows. The 48px primary rail (app-rail.tsx) sits to the left as a
  quick jump between groups, but the sidebar itself keeps the FULL menu visible
  — hiding an entire group behind a rail glyph read as "Tools by Jobsite has
  disappeared" the moment the active group changed. Collapses to icons on a
  desk layout and folds into a sheet on a phone.
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
  const pathname = usePathname();
  /* A nav row is current for its own page and everything under it, so a tool's
     detail page keeps Tool Register lit rather than leaving the rail blank. */
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* h-14 and a border, matching the top bar exactly: the job selector and
          the page title sit on the same baseline and the two borders read as
          one rule across the shell instead of a step. */}
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border p-2">
        <ProjectSwitcher />
      </SidebarHeader>

      <SidebarContent className="overscroll-contain pb-2">
        {groups.map((g) => {
          const visible = g.items.filter(
            (n: NavItem) => !n.perm || permissions.includes(n.perm),
          );
          if (!visible.length) return null;
          return (
            <SidebarGroup key={g.label}>
              <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
              <SidebarMenu>
                {visible.map((n) => {
                  const active = isCurrent(n.href);
                  return (
                    <SidebarMenuItem key={n.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={n.label}
                        /* The accent fill alone is a weak signal at this value
                           range; the marker on the leading edge is what the eye
                           actually finds, and it survives the icon-only rail. */
                        className={cn(
                          "relative transition-colors before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px]",
                          "before:-translate-y-1/2 before:rounded-r-full before:bg-sidebar-primary before:transition-opacity",
                          active ? "before:opacity-100" : "before:opacity-0",
                        )}
                      >
                        <Link href={n.href}>
                          <n.icon
                            className={cn(
                              "size-4 shrink-0 transition-colors",
                              active
                                ? "text-sidebar-primary"
                                : "text-sidebar-foreground/55 group-hover/menu-item:text-sidebar-accent-foreground",
                            )}
                          />
                          <span className="truncate">{n.label}</span>
                          {n.href === "/inbox" && inboxCount > 0 ? (
                            <SidebarMenuBadge>{inboxCount > 99 ? "99+" : inboxCount}</SidebarMenuBadge>
                          ) : null}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
