"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Star } from "lucide-react";
import { ProjectSwitcher } from "@/components/project-switcher";
import { DUR, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { groupKey, matchItem, type NavGroup, type NavItem } from "@/components/sti/nav-config";
import { pinnedItems, useNavPins } from "@/components/sti/nav-pins";

/*
  The secondary pane of the two-pane shell: the job scope selector at its head,
  then Pinned, then the rows of the ONE group the rail has selected. The rail
  answers "which part of the product am I in"; this answers "which screen".

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
  group contains. That single filtered array is also what Pinned is resolved
  against, which is what stops a pin outliving the permission that earned it;
  see `nav-pins.ts`.
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
  const { pins, toggle } = useNavPins();

  /* Pages outside the navigation — /profile, /account/password — resolve to no
     group. Falling back to the first one keeps the pane populated instead of
     showing an empty column on the screen a password reset forces you onto. */
  const active = groups.find((g) => groupKey(g) === activeGroupKey) ?? groups[0];

  /* The intersection, and the only place it happens. An id in storage naming a
     route this actor cannot reach simply does not come back out. */
  const pinned = pinnedItems(groups, pins);

  /* A nav row is current for its own page and everything under it, so a tool's
     detail page keeps Tool Register lit. `matchItem` resolves the LONGEST
     match rather than the first, which is what stops `/settings` from claiming
     `/settings/ai` and lighting two rows at once.

     Resolved across EVERY group rather than the active one, so a pinned row
     from another module lights up when you are standing on it. Same answer as
     before for the active group's rows — the longest match is unique. */
  const currentHref = matchItem(
    groups.flatMap((g) => g.items),
    pathname,
  )?.href;

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* h-14 and a border, matching the top bar exactly: the job selector and
          the page title sit on the same baseline and the two borders read as
          one rule across the shell instead of a step. */}
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border p-2">
        <ProjectSwitcher />
      </SidebarHeader>

      <SidebarContent className="overscroll-contain pb-2">
        {/*
          Pinned lands one frame after hydration — `useNavPins` cannot read
          storage during render without desynchronising from the server HTML —
          so it animates its own height open rather than popping the group
          below it downward. `initial={false}` keeps that from replaying on
          every navigation.
        */}
        <AnimatePresence initial={false}>
          {pinned.length ? (
            <motion.div
              key="pinned"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: DUR.base, ease: EASE.out }}
              className="overflow-hidden"
            >
              <SidebarGroup className="pb-0">
                <SidebarGroupLabel className="label-xs h-auto pb-1.5 text-[0.625rem]">
                  Pinned
                </SidebarGroupLabel>
                <SidebarMenu>
                  {pinned.map((n) => (
                    <NavRow
                      key={n.id}
                      item={n}
                      current={n.href === currentHref}
                      pinned
                      onTogglePin={() => toggle(n.id)}
                      inboxCount={inboxCount}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroup>
              <SidebarSeparator className="mx-3 mt-2" />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {active ? (
          <SidebarGroup>
            {/* The mono uppercase kicker — the design's signature label. It is
                the only thing naming the active group once the rail is a row of
                glyphs, so it is not decoration. */}
            <SidebarGroupLabel className="label-xs h-auto pb-1.5 text-[0.625rem]">
              {active.label}
            </SidebarGroupLabel>
            <SidebarMenu>
              {active.items.map((n) => (
                <NavRow
                  key={n.id}
                  item={n}
                  current={n.href === currentHref}
                  pinned={pins.has(n.id)}
                  onTogglePin={() => toggle(n.id)}
                  inboxCount={inboxCount}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}

/*
  One row, drawn identically wherever it appears.

  A pinned row that is ALSO in the active group renders in both places at once.
  That is correct rather than a bug: Pinned is a shortcut, not a move, and a
  row vanishing from its own module the moment you starred it would be the
  more surprising behaviour.
*/
function NavRow({
  item,
  current,
  pinned,
  onTogglePin,
  inboxCount,
}: {
  item: NavItem;
  current: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  inboxCount: number;
}) {
  const showBadge = item.href === "/inbox" && inboxCount > 0;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={current}
        tooltip={item.label}
        /* The accent fill alone is a weak signal at this value range; the
           marker on the leading edge is what the eye actually finds, and it
           survives the icon-only rail. */
        className={cn(
          "relative transition-colors before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px]",
          "before:-translate-y-1/2 before:rounded-r-full before:bg-sidebar-primary before:transition-opacity",
          current ? "before:opacity-100" : "before:opacity-0",
        )}
      >
        <Link href={item.href}>
          <item.icon
            className={cn(
              "size-4 shrink-0 transition-colors",
              current
                ? "text-sidebar-primary"
                : "text-sidebar-foreground/55 group-hover/menu-item:text-sidebar-accent-foreground",
            )}
          />
          <span className="truncate">{item.label}</span>
        </Link>
      </SidebarMenuButton>

      {/* The badge and the star both want the trailing edge. The count slides
          left out of the star's way on hover rather than the two overlapping,
          which is what a fixed offset for both produced. */}
      {showBadge ? (
        <SidebarMenuBadge className="transition-[right] duration-150 group-hover/menu-item:right-7">
          {inboxCount > 99 ? "99+" : inboxCount}
        </SidebarMenuBadge>
      ) : null}

      {/*
        Pinning needs no permission and is offered to every role — it rearranges
        the caller's own sidebar and reaches nothing. An already-pinned row
        keeps its star visible so the section is dismissable from inside itself;
        an unpinned one only shows it on hover, or the pane reads as a column of
        stars rather than a column of screens.
      */}
      <SidebarMenuAction
        showOnHover={!pinned}
        onClick={onTogglePin}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
        title={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
        className={cn(
          "hover:bg-sidebar-accent active:scale-90",
          pinned ? "text-sidebar-primary" : "text-sidebar-foreground/50",
        )}
      >
        <Star className={cn(pinned && "fill-current")} />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}
