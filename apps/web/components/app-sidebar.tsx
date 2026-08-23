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
import { groupKey, matchItem, type NavGroup } from "@/components/sti/nav-config";

/*
  The secondary pane of the two-pane shell: the job scope selector at its head,
  then the rows of the ONE group the rail has selected. The rail answers "which
  part of the product am I in"; this answers "which screen".

  It listed every group between 2026-08-23 and this change, because switching
  group appeared to delete the rest of the menu. That was real, and it was not
  this component's fault: the shell's rail offset targeted `data-slot="sidebar"`
  — the statically positioned outer wrapper — so `left` was inert, the fixed
  column sat at `left: 0`, and the rail was underneath it the whole time. With
  no visible group switcher, showing one group at a time WAS a dead end. The
  offset now targets `sidebar-container` (globals.css), so the rail is reachable
  and the design's model holds.

  Groups arrive already permission-filtered from the shell — the same array the
  rail draws from, so a glyph and its sidebar can never disagree about what a
  group contains.
*/

export function AppSidebar({
  groups,
  activeGroupKey,
  inboxCount,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  groups: NavGroup[];
  activeGroupKey: string | undefined;
  inboxCount: number;
}) {
  const pathname = usePathname();

  /* Pages outside the navigation — /profile, /account/password — resolve to no
     group. Falling back to the first one keeps the pane populated instead of
     showing an empty column on the screen a password reset forces you onto. */
  const active = groups.find((g) => groupKey(g) === activeGroupKey) ?? groups[0];

  /* A nav row is current for its own page and everything under it, so a tool's
     detail page keeps Tool Register lit. `matchItem` resolves the LONGEST
     match rather than the first, which is what stops `/settings` from claiming
     `/settings/ai` and lighting two rows at once. */
  const currentHref = matchItem(active?.items ?? [], pathname)?.href;

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* h-14 and a border, matching the top bar exactly: the job selector and
          the page title sit on the same baseline and the two borders read as
          one rule across the shell instead of a step. */}
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border p-2">
        <ProjectSwitcher />
      </SidebarHeader>

      <SidebarContent className="overscroll-contain pb-2">
        {active ? (
          <SidebarGroup>
            {/* The mono uppercase kicker — the design's signature label. It is
                the only thing naming the active group once the rail is a row of
                glyphs, so it is not decoration. */}
            <SidebarGroupLabel className="label-xs h-auto pb-1.5 text-[0.625rem]">
              {active.label}
            </SidebarGroupLabel>
            <SidebarMenu>
              {active.items.map((n) => {
                const current = n.href === currentHref;
                return (
                  <SidebarMenuItem key={n.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={current}
                      tooltip={n.label}
                      /* The accent fill alone is a weak signal at this value
                         range; the marker on the leading edge is what the eye
                         actually finds, and it survives the icon-only rail. */
                      className={cn(
                        "relative transition-colors before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px]",
                        "before:-translate-y-1/2 before:rounded-r-full before:bg-sidebar-primary before:transition-opacity",
                        current ? "before:opacity-100" : "before:opacity-0",
                      )}
                    >
                      <Link href={n.href}>
                        <n.icon
                          className={cn(
                            "size-4 shrink-0 transition-colors",
                            current
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
        ) : null}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
