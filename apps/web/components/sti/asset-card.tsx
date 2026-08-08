"use client";

import Link from "next/link";
import { formatAssetModel } from "@stinventory/types";
import { StatusPill, Tag } from "@/components/sti/status";
import { ToolIcon } from "@/components/sti/tool-icon";
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

  2. The photo frame is small and always present. It was omitted entirely while
     no photo column existed; now that tools can carry one, a fixed frame keeps
     every card the same height whether or not somebody has taken a picture.
     The placeholder is a muted glyph rather than a grey box with "no image" in
     it — the tag and model already say what the tool is.
*/

export type AssetCardRow = {
  id: string;
  tag: string | null;
  make?: string | null;
  modelNumber?: string | null;
  description?: string | null;
  categoryName?: string | null;
  status?: string | null;
  acquisitionCost?: string | number | null;
  warrantyExpiresOn?: string | null;
  custodianName?: string | null;
  locationName?: string | null;
  /** Object key resolved to a URL by the caller, or null when none was taken. */
  photoUrl?: string | null;
};

export function AssetCard({
  row,
  actions,
  selected,
  onSelectChange,
}: {
  row: AssetCardRow;
  actions?: React.ReactNode;
  /* Bulk selection: when `onSelectChange` is provided the card shows a
     checkbox and a selection ring. The label sits outside the Link so
     clicking it never navigates. */
  selected?: boolean;
  onSelectChange?: (on: boolean) => void;
}) {
  const heavy = isHighValue(row);
  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-md border bg-card transition-colors hover:border-foreground/20",
        heavy && "border-l-2 border-l-primary/60",
        selected && "ring-2 ring-primary",
      )}
    >
      {/* Always drawn. This was `opacity-0 group-hover:opacity-100`, which is
          not a gesture on a touch screen and, on the desk, hid the actions
          until the pointer happened to be over the right card. */}
      {actions ? <div className="absolute right-1.5 top-1.5 z-10">{actions}</div> : null}

      {onSelectChange ? (
        <label
          className="absolute left-2 top-2 z-10 flex size-7 cursor-pointer items-center justify-center rounded-md border border-input bg-card/90 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
          aria-label={selected ? "Remove from selection" : "Add to selection"}
        >
          <input
            type="checkbox"
            role="checkbox"
            checked={!!selected}
            onChange={(e) => onSelectChange(e.target.checked)}
            className="size-4 accent-primary"
          />
        </label>
      ) : null}

      <Link href={`/tools/${row.id}`} className="flex flex-1 flex-col">
        <div className="flex h-24 shrink-0 items-center justify-center border-b bg-muted/30">
          {row.photoUrl ? (
            /* Decorative: the tag and model already name the tool, so alt text
               here would only repeat them to a screen reader. */
            <img src={row.photoUrl} alt="" className="size-full object-contain" loading="lazy" />
          ) : (
            /* The category's own glyph, not a generic wrench: on a board of
               photo-less tools the placeholder is the only thing distinguishing
               a grinder from a ladder. */
            <ToolIcon category={row.categoryName} className="size-7 text-muted-foreground/35" />
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <span className="label-xs">
            <Tag>{row.tag}</Tag>
            {row.categoryName ? <span className="ml-1.5 normal-case">{row.categoryName}</span> : null}
          </span>
          <span className="text-sm font-medium leading-snug">
            {formatAssetModel(row) || "Untagged tool"}
          </span>
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
