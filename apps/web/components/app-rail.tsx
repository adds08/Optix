"use client";

import Link from "next/link";
import { Bot } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NavGroup } from "@/components/sti/nav-config";

/*
  The primary rail (System Shell v3).

  48px of instrument panel down the left edge: the mark, one glyph per
  navigation GROUP, and the assistant at the foot. It answers "which part of
  the product am I in", and the sidebar beside it answers "which screen".

  Two decisions worth keeping:

    - the rail is near-black in BOTH modes. It is the frame the product sits
      in, not part of the page, so it does not follow the light/dark split —
      see `--rail` in globals.css.
    - a group button is a LINK to that group's first visible row, not a
      selector. Clicking Equipment has to land you somewhere; a rail that only
      swaps the sidebar's contents leaves the page you are reading behind and
      makes the two columns disagree about where you are.

  The groups arriving here are already permission-filtered — an empty group is
  never drawn, because a glyph that opens an empty sidebar is worse than a
  missing one.

  Adaptations for main's nav-config (which ships `NavGroup = { label, items }`
  with per-ITEM icons and no group key): the group key is derived from the
  label and the rail glyph is the first item's icon, since that is the one
  glyph that always exists for a visible group.
*/

const groupKey = (g: NavGroup) => g.label.toLowerCase().replace(/[^a-z]+/g, "-");

export function AppRail({
  groups,
  activeKey,
  aiOpen,
  onToggleAi,
}: {
  groups: NavGroup[];
  activeKey: string | undefined;
  aiOpen: boolean;
  onToggleAi: () => void;
}) {
  return (
    <nav
      aria-label="Sections"
      className="flex w-12 shrink-0 flex-col items-center gap-0.5 border-r border-sidebar-border bg-rail py-2.5"
    >
      {/* The monogram stands in for a real logo — there isn't one yet. */}
      <Link
        href="/home"
        aria-label="STInventory home"
        className="mb-2.5 grid size-8 shrink-0 place-items-center rounded-md bg-primary font-mono text-[11px] font-extrabold text-primary-foreground"
      >
        ST
      </Link>

      {groups.map((g) => {
        const key = groupKey(g);
        const active = key === activeKey;
        const first = g.items[0];
        if (!first) return null;
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <Link
                href={first.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-md transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-rail-foreground hover:bg-white/5 hover:text-sidebar-accent-foreground",
                )}
              >
                <first.icon className="size-[17px]" aria-hidden />
                <span className="sr-only">{g.label}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{g.label}</TooltipContent>
          </Tooltip>
        );
      })}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onToggleAi}
            aria-pressed={aiOpen}
            className={cn(
              "mt-auto grid size-9 shrink-0 place-items-center rounded-md transition-colors",
              aiOpen
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-rail-foreground hover:bg-white/5 hover:text-sidebar-accent-foreground",
            )}
          >
            <Bot className="size-[17px]" aria-hidden />
            <span className="sr-only">Assistant</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Assistant</TooltipContent>
      </Tooltip>
    </nav>
  );
}
