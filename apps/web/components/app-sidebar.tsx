"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProjectSwitcher } from "@/components/project-switcher";
import { cn } from "@/lib/utils";
import { isCurrent, seatFor, type NavGroup } from "@/components/sti/nav-config";

/*
  The secondary navigation (System Shell v3).

  A 200px panel holding one thing: the rows of whichever group the rail has
  lit. Above them the system-wide job selector, below them the seat — who you
  are signed in as and what that seat can actually see.

  The group's own name is NOT repeated above the rows. It is already on screen
  as the rail's lit glyph and again as the page subtitle in the top bar; a
  third copy is the kind of label that makes a dense screen feel padded. What
  is not obvious from the rail — the seat and its scope — gets the space
  instead.

  Collapse is driven from the top bar and animates the panel to zero width
  rather than to an icon strip: the rail already IS the icon strip, so a
  second one would say the same thing twice at half the legibility.
*/

export function AppSidebar({
  group,
  collapsed,
  role,
  inboxCount,
}: {
  /* The active rail group, already permission-filtered. Undefined on a route
     outside the nav (a detail page reached by link, say) — the panel still
     renders its chrome so the layout does not jump. */
  group: NavGroup | undefined;
  collapsed: boolean;
  role: string | null;
  inboxCount: number;
}) {
  const pathname = usePathname();
  const seat = seatFor(role);

  return (
    <div
      /* Width animates; the inner column keeps its full 200px so the rows do
         not reflow into a single character on the way closed. */
      className={cn(
        "shrink-0 overflow-hidden bg-sidebar transition-[width,border] duration-200 ease-out",
        collapsed ? "w-0 border-r-0" : "w-50 border-r border-sidebar-border",
      )}
      aria-hidden={collapsed}
    >
      <div className="flex h-full w-50 flex-col">
        {/* h-14, matching the top bar exactly: the job selector and the page
            title sit on the same baseline and the two bottom borders read as
            one rule across the shell instead of a step. */}
        <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-2">
          <ProjectSwitcher />
        </div>

        <nav aria-label={group?.label ?? "Pages"} className="sti-scroll min-h-0 flex-1 p-2">
          {group?.items.map((n) => {
            const active = isCurrent(n.href, pathname);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md px-2.5 text-[13.5px] transition-colors",
                  active
                    ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/45 hover:text-sidebar-accent-foreground",
                )}
              >
                <n.icon
                  className={cn("size-4 shrink-0", active ? "text-sidebar-primary" : "opacity-70")}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{n.label}</span>
                {n.href === "/inbox" && inboxCount > 0 ? (
                  <span className="tnum shrink-0 font-mono text-[11px] font-bold text-muted-foreground">
                    {inboxCount > 99 ? "99+" : inboxCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-sidebar-border px-3 py-2.5">
          <p className="text-xs font-semibold text-sidebar-foreground">{seat.label}</p>
          <p className="text-[11px] text-muted-foreground">{seat.scope}</p>
        </div>
      </div>
    </div>
  );
}
