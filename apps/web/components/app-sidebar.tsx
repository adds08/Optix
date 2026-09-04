"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronUp, Pin, PinOff } from "lucide-react";
import { ProjectSwitcher } from "@/components/project-switcher";
import { DUR, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
import { pinnedItems, type NavPins } from "@/components/sti/nav-pins";

/*
  The secondary pane of the two-pane shell: the active group's label, then
  Pinned, then the rows of the ONE group the rail has selected. The rail
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
  rail and the feature launcher draw from, so a glyph, a sidebar and a launcher
  card can never disagree about what a group contains. That single filtered
  array is also what Pinned is resolved against, which is what stops a pin
  outliving the permission that earned it; see `nav-pins.ts`.

  The scope selector moved OUT of this pane on 2026-09-04: the design puts it in
  the top bar, next to the breadcrumb. `navPins` is owned by the shell now too,
  so the Pinned section here and the launcher's Pinned row share one state.
*/

export type SidebarTenant = {
  name: string | null;
  slug: string | null;
  brandingName: string | null;
  brandingLayoutMode: string;
} | null;

export function AppSidebar({
  groups,
  activeGroupKey,
  inboxCount,
  tenant,
  navPins,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  groups: NavGroup[];
  activeGroupKey: string | undefined;
  inboxCount: number;
  navPins: NavPins;
  /* Candidate placement A (2026-08-30) — a permanent org-identity block in
     the footer, compared live against candidate B, the same block merged
     into UserMenu. Whichever the client prefers stays; the other gets
     deleted in a follow-up, not left behind half-used. */
  tenant?: SidebarTenant;
}) {
  const pathname = usePathname();
  const { pins, order, toggle, move } = navPins;

  /* Pages outside the navigation — /profile, /account/password — resolve to no
     group. Falling back to the first one keeps the pane populated instead of
     showing an empty column on the screen a password reset forces you onto. */
  const active = groups.find((g) => groupKey(g) === activeGroupKey) ?? groups[0];

  /* The intersection, and the only place it happens. An id in storage naming a
     route this actor cannot reach simply does not come back out.

     Scoped to the ACTIVE group only (changed 2026-08-30) — a pin from Registry
     used to surface in the Pinned section while standing in Organization too,
     on the reasoning that "the screens you actually live in should be one
     click away regardless of module". In practice that read as the Pinned
     section randomly changing contents as you moved the rail, which is a
     worse surprise than the shortcut it bought. `pinnedItems` only needs the
     one group's items to resolve against — passing `[active]` instead of the
     full `groups` array is the entire change, since the function's own
     intersection logic already does the filtering. */
  const pinned = active ? pinnedItems([active], order) : [];

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
      {/* On a phone the sheet IS the menu, so the scope selector lives here
          (md:hidden) — the top bar carries it on desktop. Same component; this
          is just the mobile seat, mirroring where it sat before 2026-09-04. */}
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border p-2 md:hidden">
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
                  {pinned.map((n, i) => (
                    <NavRow
                      key={n.id}
                      item={n}
                      current={n.href === currentHref}
                      pinned
                      onTogglePin={() => toggle(n.id)}
                      inboxCount={inboxCount}
                      /* Reordering is offered only in the Pinned section. The
                         same row in its own group has no order to change — the
                         tree's order is the tree's. */
                      onMoveUp={i > 0 ? () => move(n.id, -1) : undefined}
                      onMoveDown={i < pinned.length - 1 ? () => move(n.id, 1) : undefined}
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
              {/* Pinned rows are MOVED, not copied. A pinned row is drawn in the
                  Pinned section and nowhere else, so the pane never shows the
                  same screen twice.

                  This reversed an earlier decision on 2026-08-28. The pane used
                  to draw a pinned row in both places on the reasoning that
                  "Pinned is a shortcut, not a move" — but two identical rows a
                  few pixels apart reads as a duplicate rather than as a
                  shortcut, and pinning something you already had in view then
                  looks like it did nothing except make a copy.

                  The group itself stays on the rail even when every one of its
                  rows is pinned: `railGroups` in `app-shell.tsx` is untouched by
                  this filter, so pinning cannot make a whole module's glyph
                  disappear. The pane simply shows the Pinned section, with those
                  rows sitting directly above. */}
              {active.items
                .filter((n) => !pins.has(n.id))
                .map((n) => (
                  <NavRow
                    key={n.id}
                    item={n}
                    current={n.href === currentHref}
                    pinned={false}
                    onTogglePin={() => toggle(n.id)}
                    inboxCount={inboxCount}
                  />
                ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      {tenant ? (
        <SidebarFooter className="border-t border-sidebar-border p-2">
          <OrgIdentity tenant={tenant} />
        </SidebarFooter>
      ) : null}

      <SidebarRail />
    </Sidebar>
  );
}

/*
  Candidate placement A — a permanent org-identity block, always visible,
  every screen. No switcher: `session.tenantId` is singular today (a user
  belongs to exactly one tenant), so there is nothing to switch between yet.
  This renders the identity now and leaves room for a switcher the day that
  stops being true, rather than building one against data that cannot yet
  hold a second tenant.
*/
function OrgIdentity({ tenant }: { tenant: NonNullable<SidebarTenant> }) {
  const displayName = tenant.brandingName || tenant.name || "—";
  const iconOnly = tenant.brandingLayoutMode === "icon_only";
  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <OrgAvatar name={displayName} />
      {!iconOnly ? (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-sidebar-foreground">{displayName}</span>
          {tenant.slug ? (
            <span className="truncate text-xs text-sidebar-foreground/50">{tenant.slug}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* Same shape as UserMenu's initials avatar, deliberately — an org and a
   person are both "an identity with a name and no picture yet" until a logo
   upload exists (see the schema comment on tenantSettings.brandingName). A
   square rather than a circle is the only difference, so the two are never
   mistaken for each other at a glance. */
export function OrgAvatar({ name, className }: { name: string; className?: string }) {
  const initial = name.trim()[0]?.toUpperCase() ?? "?";
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground",
        className,
      )}
      aria-hidden
    >
      {initial}
    </span>
  );
}

/*
  One row, drawn identically wherever it appears.

  A pinned row is drawn ONCE, in the Pinned section, and filtered out of its own
  group — it moves rather than being copied. The pane used to draw it in both
  places; two identical rows inches apart read as a duplicate, not a shortcut.
*/
function NavRow({
  item,
  current,
  pinned,
  onTogglePin,
  inboxCount,
  onMoveUp,
  onMoveDown,
}: {
  item: NavItem;
  current: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  inboxCount: number;
  /* Undefined at the ends of the list rather than disabled buttons: a control
     that is always there and usually does nothing trains people to ignore it. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const showBadge = item.href === "/inbox" && inboxCount > 0;
  const reorderable = !!(onMoveUp || onMoveDown);
  /* "upcoming" loses the link entirely — no click-through, matching the
     tenant feature-state contract (apps/web/components/sti/nav-config.ts).
     "beta" stays a normal row; the badge is the only difference. */
  const upcoming = item.featureState === "upcoming";

  const rowContent = (
    <>
      <item.icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          upcoming
            ? "text-sidebar-foreground/35"
            : current
              ? "text-sidebar-primary"
              : "text-sidebar-foreground/55 group-hover/menu-item:text-sidebar-accent-foreground",
        )}
      />
      <span className={cn("truncate", upcoming && "text-sidebar-foreground/45")}>{item.label}</span>
      {item.featureState ? (
        <span className="ml-auto shrink-0 rounded-sm bg-sidebar-accent px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-sidebar-foreground/60">
          {item.featureState === "upcoming" ? "Soon" : "Beta"}
        </span>
      ) : null}
    </>
  );

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild={!upcoming}
        isActive={current}
        tooltip={upcoming ? `${item.label} — coming soon` : item.label}
        aria-disabled={upcoming || undefined}
        /* The accent fill alone is a weak signal at this value range; the
           marker on the leading edge is what the eye actually finds, and it
           survives the icon-only rail. */
        className={cn(
          "relative transition-colors before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px]",
          "before:-translate-y-1/2 before:rounded-r-full before:bg-sidebar-primary before:transition-opacity",
          current ? "before:opacity-100" : "before:opacity-0",
          upcoming && "cursor-default opacity-70 hover:bg-transparent",
        )}
      >
        {upcoming ? rowContent : <Link href={item.href}>{rowContent}</Link>}
      </SidebarMenuButton>

      {/* The badge and the star both want the trailing edge. The count slides
          left out of the star's way on hover rather than the two overlapping,
          which is what a fixed offset for both produced. */}
      {showBadge ? (
        <SidebarMenuBadge
          className={cn(
            "transition-[right] duration-150",
            /* Far enough left to clear whatever is actually there: the star
               alone, or the star plus two chevrons on a reorderable row. */
            reorderable ? "group-hover/menu-item:right-[4.25rem]" : "group-hover/menu-item:right-7",
          )}
        >
          {inboxCount > 99 ? "99+" : inboxCount}
        </SidebarMenuBadge>
      ) : null}

      {/*
        Reordering, offered only on pinned rows.

        Up/down rather than drag-and-drop: this pane is narrow and scrollable,
        dragging inside it is awkward on a touchpad and unusable on the phone
        sheet, and the only ordering anybody wants is "put that one at the top".

        Absolutely positioned and revealed on hover, so the row's height and the
        pane's layout are identical whether or not these are showing — the rule
        in `.claude/rules/web.md`: space for a control that comes and goes is
        reserved, never created. `focus-within` keeps them reachable by keyboard,
        where there is no hover to trigger.
      */}
      {reorderable ? (
        <span className="absolute right-7 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!onMoveUp}
            aria-label={`Move ${item.label} up`}
            title="Move up"
            className="flex size-5 items-center justify-center rounded text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-90 disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronUp className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!onMoveDown}
            aria-label={`Move ${item.label} down`}
            title="Move down"
            className="flex size-5 items-center justify-center rounded text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-90 disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </span>
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
        {/* A pin, not a star. A star means "favourite" and invites a rating;
            a pin means "keep this here", which is what the control does. */}
        {pinned ? <PinOff /> : <Pin />}
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}
