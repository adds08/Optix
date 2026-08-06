"use client";

import { useState } from "react";
import { formatAssetModel } from "@stinventory/types";
import { StatusPill } from "@/components/sti/status";
import { Highlight } from "@/components/highlight";
import { ToolMenu } from "@/components/tool-menu";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  The tool table used by the crew rows and the loose-tools sections on Tools by
  Jobsite. It lives here, not in `page.tsx`, because Next.js 15 forbids a page
  from exporting anything other than its default — a shared table has to be a
  real module of its own.

  Long lists collapse to five rows with a "Show N more" toggle so a card never
  dumps its whole inventory at once — the register is the place for the full
  list, the hub is for reading the shape of the yard.
*/

export type ToolRow = {
  id: string;
  tag: string | null;
  serialNumber: string | null;
  make: string | null;
  modelNumber: string | null;
  description: string | null;
  categoryName: string | null;
  status: string | null;
  acquisitionCost: string | null;
  /* asset.list names these `custodianId` / `locationId` (no current_ prefix). */
  custodianId?: string | null;
  custodianName?: string | null;
  currentProjectId?: string | null;
  locationId?: string | null;
  locationName?: string | null;
};

export const TOOL_LIMIT = 5;

/* Serial / ID · Tool name · Status · Value. No "rides on" column: the row
   already sits under the rig it rides in. When `selectable`, each row gets a
   checkbox the parent drives — used by the "on site, nobody holding" sections
   so a desk can pick several tools and hand them to a foreman at once. */
export function ToolTable({
  rows,
  showWhere,
  selectable,
  selectedIds,
  onToggle,
  highlight,
  actions,
}: {
  rows: ToolRow[];
  showWhere?: boolean;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
  /* The live search text — the tag and tool-name cells mark the first match
     when it is four letters or longer (see Highlight). */
  highlight?: string;
  /* Adds the per-row ⋯ menu (return to the yard, hand over, change status,
     note) the register uses — the crew rows and loose sections share it so
     "how do I change this tool's status or take it off its foreman" is the
     same gesture everywhere. */
  actions?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, TOOL_LIMIT);
  const remaining = rows.length - TOOL_LIMIT;

  return (
    <div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-accent/35 text-foreground">
            {selectable ? <th className="w-8 px-3 py-1.5" aria-hidden /> : null}
            <th className="label-xs w-32 px-3 py-1.5 text-left">Serial / ID</th>
            <th className="label-xs px-3 py-1.5 text-left">Tool name</th>
            <th className="label-xs w-36 px-3 py-1.5 text-left">Status</th>
            <th className="label-xs w-24 px-3 py-1.5 text-right">Value</th>
            {actions ? <th className="w-10 px-3 py-1.5" aria-hidden /> : null}
          </tr>
        </thead>
        <tbody>
          {visible.map((t) => (
            <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
              {selectable && onToggle ? (
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds?.has(t.id) ?? false}
                    onChange={() => onToggle(t.id)}
                    aria-label={`Select ${t.tag ?? t.serialNumber ?? "this tool"}`}
                    className="size-4 accent-primary"
                  />
                </td>
              ) : null}
              <td className="px-3 py-2 font-mono text-[13px] text-muted-foreground">
                <Highlight text={t.tag ?? t.serialNumber ?? "Untagged"} q={highlight} />
              </td>
              <td className="px-3 py-2">
                <span className="font-medium">
                  <Highlight text={formatAssetModel(t) || "No description"} q={highlight} />
                </span>
                {showWhere && t.locationName ? (
                  <span className="block text-xs text-muted-foreground">
                    <Highlight text={t.locationName} q={highlight} />
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2"><StatusPill status={t.status} /></td>
              <td className="tnum px-3 py-2 text-right text-muted-foreground">{money(t.acquisitionCost)}</td>
              {actions ? (
                <td className="px-2 py-2 text-right">
                  <ToolMenu assetId={t.id} assetTag={t.tag ?? t.serialNumber ?? "Untagged"} heldBySomeone={!!t.custodianId} />
                </td>
              ) : null}
            </tr>
          ))}
          {visible.length === 0 ? (
            <tr>
              <td className="px-3 py-2.5 text-sm text-muted-foreground" colSpan={selectable && actions ? 6 : selectable || actions ? 5 : 4}>
                Nothing here.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {rows.length > TOOL_LIMIT ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className={cn(
            "w-full border-t px-3 py-1.5 text-center text-xs font-medium text-primary hover:bg-accent/40",
          )}
        >
          {showAll ? "Show fewer" : `Show ${remaining} more of ${rows.length}`}
        </button>
      ) : null}
    </div>
  );
}
