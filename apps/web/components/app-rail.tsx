"use client";

import Link from "next/link";
import { Bot } from "lucide-react";
import { OptixTile } from "@/components/optix-mark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { footGroups, groupKey, mainGroups, type NavGroup } from "@/components/sti/nav-config";

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
    - the foot is not the flow. The assistant and Settings sit below the
      spacer because neither is a part of the product you work IN — one is a
      tool you summon over the page, the other is where you go to change how
      the product behaves. A gear sitting between Equipment and Insight reads
      as a sixth module.

  The groups arriving here are already permission-filtered — an empty group is
  never drawn, because a glyph that opens an empty sidebar is worse than a
  missing one.
*/

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
      className="hidden w-12 shrink-0 flex-col items-center gap-0.5 border-r border-rail-accent/20 bg-rail py-2.5 md:flex"
    >
      {/* The mark, at the head of the chassis — the logo on its own plate, not
          the app's primary blue borrowed for a tile. `optix-mark.tsx` is the
          one definition, shared with the sign-in page and the boot splash, so
          the three cannot drift. */}
      <Link href="/home" aria-label="Optix home" className="mb-2.5 shrink-0">
        <OptixTile className="size-8" />
      </Link>

      {mainGroups(groups).map((g) => (
        <RailGroup key={groupKey(g)} group={g} active={groupKey(g) === activeKey} />
      ))}

      {/* The foot cluster. `mt-auto` moves here from the assistant button so
          Settings stays welded underneath it rather than floating up when a
          role has few groups. */}
      <div className="mt-auto flex flex-col items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleAi}
              aria-pressed={aiOpen}
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-md transition-colors",
                aiOpen
                  ? "bg-rail-accent text-rail-accent-foreground"
                  : "text-rail-foreground hover:bg-rail-accent/60 hover:text-rail-accent-foreground",
              )}
            >
              <Bot className="size-[17px]" aria-hidden />
              <span className="sr-only">Assistant</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Assistant</TooltipContent>
        </Tooltip>

        {footGroups(groups).map((g) => (
          <RailGroup key={groupKey(g)} group={g} active={groupKey(g) === activeKey} />
        ))}
      </div>
    </nav>
  );
}

/* One glyph, wherever it sits. The group's own `icon` rather than its first
   row's, so reordering rows cannot move the target somebody aims at. */
function RailGroup({ group, active }: { group: NavGroup; active: boolean }) {
  const first = group.items[0];
  if (!first) return null;
  const Icon = group.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={first.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-md transition-colors",
            active
              ? "bg-rail-accent text-rail-accent-foreground"
              : "text-rail-foreground hover:bg-rail-accent/60 hover:text-rail-accent-foreground",
          )}
        >
          <Icon className="size-[17px]" aria-hidden />
          <span className="sr-only">{group.label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{group.label}</TooltipContent>
    </Tooltip>
  );
}
