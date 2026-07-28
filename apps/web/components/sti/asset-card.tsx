"use client";

import Link from "next/link";
import { StatusPill, Tag } from "@/components/sti/status";
import { FlagBadges, isHighValue } from "@/components/sti/flags";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  Card form of a register row.

  What a table cannot do well and this can: value hierarchy. In a table every
  row weighs the same, so a $33k total station and a $260 drill look identical.
  Here the expensive one carries a marked edge and a darker price.

  Two deliberate restraints:

  1. The signal is quiet. A 2px edge and a weight change, not a colour block —
     a register where a fifth of the rows shout is a register nobody scans.

  2. No empty photo frame. There is no photo column on `asset` yet, so a
     placeholder would appear on *every* card: a third of the surface given to
     something that is never information. The frame renders only when there is
     an image, so wiring `photoUrl` up later changes this file not at all.
*/

export type AssetCardRow = {
  id: string;
  tag: string;
  modelName: string;
  categoryName?: string | null;
  status?: string | null;
  acquisitionCost?: string | number | null;
  warrantyExpiresOn?: string | null;
  custodianName?: string | null;
  locationName?: string | null;
  /** Not in the schema yet — see docs/01-plan.md §18. */
  photoUrl?: string | null;
};

export function AssetCard({ row, actions }: { row: AssetCardRow; actions?: React.ReactNode }) {
  const heavy = isHighValue(row);
  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-md border bg-card transition-colors hover:border-foreground/20",
        heavy && "border-l-2 border-l-primary/60",
      )}
    >
      {actions ? (
        <div className="absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {actions}
        </div>
      ) : null}

      <Link href={`/tools/${row.id}`} className="flex flex-1 flex-col">
        {row.photoUrl ? (
          <div className="flex h-28 items-center justify-center border-b bg-muted/40">
            {/* Decorative: the tag and model already name the tool, so an alt
                text here would only repeat them to a screen reader. */}
            <img src={row.photoUrl} alt="" className="size-full object-contain" />
          </div>
        ) : null}

        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <span className="label-xs">
            <Tag>{row.tag}</Tag>
            {row.categoryName ? <span className="ml-1.5 normal-case">{row.categoryName}</span> : null}
          </span>
          <span className="text-sm font-medium leading-snug">{row.modelName}</span>
          <FlagBadges asset={row} />

          <div className="mt-auto flex items-end justify-between gap-2 pt-2">
            <span className="flex flex-col gap-1">
              <StatusPill status={row.status} />
              <span className="truncate text-xs text-muted-foreground">
                {row.custodianName ?? row.locationName ?? "In warehouse"}
              </span>
            </span>
            {/* Weight and contrast carry the value difference — no size jump,
                which is what made the expensive rows shout. */}
            <span
              className={cn(
                "tnum shrink-0 text-sm",
                heavy ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
              )}
            >
              {money(row.acquisitionCost)}
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}
