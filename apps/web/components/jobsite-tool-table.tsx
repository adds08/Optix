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
  /* asset.list returns the register's condition (new/good/fair/poor/damaged);
     declared here because the Blocky concept view reads it. */
  condition?: string | null;
  /* asset.list names these `custodianId` / `locationId` (no current_ prefix). */
  custodianId?: string | null;
  custodianName?: string | null;
  currentProjectId?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  /* The rig recorded on the ACTIVE assignment (STI-203) — a per-custody fact
     that can differ from the crew's rig above the table. */
  currentTruckUnit?: string | null;
  currentTruckOwnership?: string | null;
  currentTrailerUnit?: string | null;
};

export const TOOL_LIMIT = 5;

/* Serial / ID · Tool name · Rides in · Status · Value. "Rides in" is the rig
   recorded on the tool's own assignment (STI-203) — it usually matches the
   crew rig above the table, and the desk cares exactly when it does not
   (a tool left in the previous truck, or nothing recorded). When `selectable`,
   each row gets a checkbox the parent drives — used by the "on site, nobody
   holding" sections so a desk can pick several tools and hand them to a
   foreman at once. */
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
      <div className="overflow-x-auto"><table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-foreground">
            {selectable ? <th className="w-8 px-3 py-1.5" aria-hidden /> : null}
            <th className="label-xs w-32 px-3 py-1.5 text-left">Serial / ID</th>
            <th className="label-xs px-3 py-1.5 text-left">Tool name</th>
            <th className="label-xs w-36 px-3 py-1.5 text-left">Rides in</th>
            <th className="label-xs w-36 px-3 py-1.5 text-left">Status</th>
            <th className="label-xs w-24 px-3 py-1.5 text-right">Value</th>
            {actions ? <th className="w-10 px-3 py-1.5" aria-hidden /> : null}
          </tr>
        </thead>
        <tbody>
          {visible.map((t, i) => (
            /* Alternating fills, not a rule under every row: the design sections
               a table by tone rather than by lines, which is what lets a wide
               row be followed across without the grid closing in. */
            <tr
              key={t.id}
              className={cn(
                "transition-colors hover:bg-accent/40",
                i % 2 ? "bg-muted/25" : "bg-transparent",
              )}
            >
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
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {t.currentTruckUnit || t.currentTrailerUnit ? (
                  <>
                    {t.currentTruckUnit ?? ""}
                    {/* Company vs personal, wherever a truck is shown
                        (STI-501). A tool riding a foreman's own truck is the
                        case the departure path cares about. */}
                    {t.currentTruckUnit && t.currentTruckOwnership === "personal_allowance" ? (
                      /* warn tokens, not raw amber-100/amber-950: a hardcoded
                         Tailwind hue is the one thing in this file no palette
                         and no mode can follow, and "riding a personal truck"
                         is precisely a needs-attention state. */
                      <span className="ml-1 rounded-sm border border-warn/30 bg-warn-bg px-1 text-[10px] font-medium text-warn">
                        personal
                      </span>
                    ) : null}
                    {t.currentTruckUnit && t.currentTrailerUnit ? " · " : ""}
                    {t.currentTrailerUnit ?? ""}
                  </>
                ) : (
                  "—"
                )}
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
              <td className="px-3 py-2.5 text-sm text-muted-foreground" colSpan={selectable && actions ? 7 : selectable || actions ? 6 : 5}>
                Nothing here.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table></div>
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
