"use client";

import { useMemo, useState } from "react";
import { formatAssetModel } from "@stinventory/types";
import { humanize } from "@/components/sti/status";
import { Highlight } from "@/components/highlight";
import { ToolMenu } from "@/components/tool-menu";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  compact,
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
  /* A flexible row instead of a fixed-column table — for the jobsite card
     view's right sheet, which is too narrow for Tag/Tool/Category/Status/
     Condition to sit side by side. Fitting them anyway forced
     `.sti-table-scroll` to scroll HORIZONTALLY nested inside the sheet's own
     vertical scroll — two scrollbars in one panel, which is the exact
     stacked-scroll-container shape `web.md` already warns about for the
     shell wrapper, just one level down. Compact mode drops the column grid
     entirely rather than trimming columns, so there is nothing left that can
     overflow sideways. Sort, the highlight, the fold and ToolMenu are all
     shared with the table branch below — only the layout differs. */
  compact?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  /*
    Sorting lives here rather than coming from DataTable.

    This is a hand-rolled table on purpose — it carries selection, a per-row
    menu and a "show N more" fold that the register's DataTable does not, and
    swapping it for DataTable to gain three sortable columns would be a rewrite
    of the screen the whole product is driven from. Four keys, one comparator.
  */
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "tag", desc: false });

  const sorted = useMemo(() => {
    const dir = sort.desc ? -1 : 1;
    /* Slice first: sorting in place would reorder the caller's array, and the
       crew card hands us the same array it uses for its own count. */
    return [...rows].sort((a, b) => dir * compare(a, b, sort.key));
  }, [rows, sort]);

  const visible = showAll ? sorted : sorted.slice(0, TOOL_LIMIT);
  const remaining = rows.length - TOOL_LIMIT;

  const onSort = (key: SortKey) =>
    setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }));

  /* Counted, not spelled out as nested ternaries. The old expression hardcoded
     a column count that stopped being true the moment the columns changed, and
     a wrong colSpan fails silently — the empty row just stops spanning. */
  const colCount =
    5 + (selectable ? 1 : 0) + (showWhere ? 1 : 0) + (actions ? 1 : 0);

  if (compact) {
    return (
      <div>
        {/* No `.sti-table-scroll` wrapper and no fixed-width cells — this is
            the whole fix. Each row is free to wrap its own text rather than
            demanding a lane, so the panel's own vertical scroll is the only
            scroll anything here does. */}
        <div role="list" className="divide-y">
          {visible.map((t, i) => (
            <div
              key={t.id}
              role="listitem"
              className={cn(
                "flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-accent/40",
                i % 2 ? "bg-muted/25" : "bg-transparent",
              )}
            >
              {selectable && onToggle ? (
                <input
                  type="checkbox"
                  checked={selectedIds?.has(t.id) ?? false}
                  onChange={() => onToggle(t.id)}
                  aria-label={`Select ${t.tag ?? t.serialNumber ?? "this tool"}`}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={`/tools/${t.id}`}
                        className="shrink-0 font-mono text-xs text-foreground/75 underline-offset-4 hover:text-primary hover:underline"
                      >
                        <Highlight text={t.tag ?? t.serialNumber ?? "Untagged"} q={highlight} />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64">
                      <span className="block font-semibold">{formatAssetModel(t) || "No description"}</span>
                      {t.serialNumber ? <span className="block font-mono opacity-80">{t.serialNumber}</span> : null}
                      <span className="block capitalize opacity-80">{humanize(t.status)}</span>
                      {t.custodianName ? <span className="block opacity-80">Held by {t.custodianName}</span> : null}
                      <span className="mt-1 block opacity-60">Click to open</span>
                    </TooltipContent>
                  </Tooltip>
                  <span className="min-w-0 truncate text-[13px] text-foreground">
                    <Highlight text={formatAssetModel(t) || "No description"} q={highlight} />
                  </span>
                </div>
                {/* One subtext line carries what used to be three columns —
                    Category, Condition, Where — comma-separated and free to
                    wrap. Nothing here is load-bearing for width the way a
                    `<td>` was, so a long value just takes a second line. */}
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {t.categoryName ?? "Uncategorized"}
                  {" · "}
                  <span className={cn("capitalize", CONDITION_TONE[(t.condition ?? "").toLowerCase()] ?? "")}>
                    {t.condition ?? "condition unknown"}
                  </span>
                  {showWhere ? (
                    <>
                      {" · "}
                      {t.locationName ?? t.currentTruckUnit ?? t.currentTrailerUnit ?? "—"}
                      {t.currentTruckUnit && t.currentTruckOwnership === "personal_allowance" ? (
                        <span className="ml-1 rounded-sm border border-warn/30 bg-warn-bg px-1 text-[10px] font-medium text-warn">
                          personal
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap pt-0.5 text-[11px] text-muted-foreground">
                {humanize(t.status)}
              </span>
              {actions ? (
                <ToolMenu assetId={t.id} assetTag={t.tag ?? t.serialNumber ?? "Untagged"} heldBySomeone={!!t.custodianId} />
              ) : null}
            </div>
          ))}
          {visible.length === 0 ? <p className="px-3 py-2.5 text-sm text-muted-foreground">Nothing here.</p> : null}
        </div>
        {rows.length > TOOL_LIMIT ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="w-full border-t px-3 py-1.5 text-center text-xs font-medium text-primary hover:bg-accent/40"
          >
            {showAll ? "Show fewer" : `Show ${remaining} more of ${rows.length}`}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className="sti-table-scroll overflow-x-auto"><table className="sti-grid w-full text-sm">
        {/*
          The header is a distinct band, not a slightly tinted first row.

          `bg-muted/50` against a card put roughly two percent of lightness
          between the head and the rows beneath it, so a long list read as one
          undifferentiated block with no obvious top. It now takes the full
          muted surface and a stronger bottom rule, which is the same treatment
          in both modes because both tokens move together.
        */}
        <thead className="bg-muted">
          {/* On the cells, not on the row: the table is `border-collapse:
              separate` (see `.sti-grid`), under which a border declared on a
              `<tr>` does not paint at all. This is the header's deliberate
              double rule, kept. */}
          <tr className="text-foreground [&>th]:border-b-2 [&>th]:border-border">
            {selectable ? <th className="w-8 px-3 py-2" aria-hidden /> : null}
            <SortHead className="w-28" k="tag" sort={sort} onSort={onSort}>Tag</SortHead>
            <SortHead k="name" sort={sort} onSort={onSort}>Tool</SortHead>
            <SortHead className="w-32" k="category" sort={sort} onSort={onSort}>Category</SortHead>
            {showWhere ? (
              <SortHead className="w-44" k="rides" sort={sort} onSort={onSort}>Where</SortHead>
            ) : null}
            <SortHead className="w-28" k="status" sort={sort} onSort={onSort}>Status</SortHead>
            <SortHead className="w-28" align="right" k="condition" sort={sort} onSort={onSort}>Condition</SortHead>
            {/* The actions column needs a header cell even though it has no
                label. Without it the head was one cell SHORT of the body — the
                row menu's column had no `th`, so `bg-muted` stopped at
                Condition and the corner above the menus rendered as an unpainted
                white notch hanging off the end of the header band.

                `colCount` above already counted this column, which is why the
                empty-state row spanned correctly and the gap looked like a
                styling artefact rather than a missing element. Width matches the
                body cell so the two line up. */}
            {actions ? <th className="w-12 px-2 py-2" aria-hidden /> : null}
          </tr>
        </thead>
        <tbody>
          {visible.map((t, i) => (
            /* Alternating fills AND rules. The fills used to be the only thing
               sectioning this table — "by tone rather than by lines" — which
               held right up until somebody read it on a pale theme, where two
               percent of lightness is nothing and a wide row has no track to
               follow along. `sti-grid` on the table draws the lines; the banding
               stays because the two do different jobs: the rule says where a row
               ends, the fill says which row you are on. */
            <tr
              key={t.id}
              className={cn(
                "transition-colors hover:bg-accent/40",
                i % 2 ? "bg-muted/25" : "bg-transparent",
              )}
            >
              {selectable && onToggle ? (
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selectedIds?.has(t.id) ?? false}
                    onChange={() => onToggle(t.id)}
                    aria-label={`Select ${t.tag ?? t.serialNumber ?? "this tool"}`}
                    className="size-4 accent-primary"
                  />
                </td>
              ) : null}
              <td className="px-3 py-2.5">
                {/* The tag is the tool's identity in the yard, so it is the
                    handle: hover for what it is, click to open it. An untagged
                    tool still links — it has an id even when nobody has put a
                    label on it — but it is not dressed up as a code. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/tools/${t.id}`}
                      className="font-mono text-sm text-foreground/75 underline-offset-4 hover:text-primary hover:underline"
                    >
                      <Highlight text={t.tag ?? t.serialNumber ?? "Untagged"} q={highlight} />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-64">
                    <span className="block font-semibold">{formatAssetModel(t) || "No description"}</span>
                    {t.serialNumber ? (
                      <span className="block font-mono opacity-80">{t.serialNumber}</span>
                    ) : null}
                    <span className="block capitalize opacity-80">{humanize(t.status)}</span>
                    {t.custodianName ? (
                      <span className="block opacity-80">Held by {t.custodianName}</span>
                    ) : null}
                    <span className="mt-1 block opacity-60">Click to open</span>
                  </TooltipContent>
                </Tooltip>
              </td>
              <td className="px-3 py-2.5">
                <span className="block truncate text-[13px] text-foreground">
                  <Highlight text={formatAssetModel(t) || "No description"} q={highlight} />
                </span>
              </td>
              <td className="truncate px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                {t.categoryName ?? "—"}
              </td>
              {showWhere ? (
                <td className="truncate px-3 py-2.5 text-[13px] text-muted-foreground">
                  {t.locationName ?? t.currentTruckUnit ?? t.currentTrailerUnit ?? "—"}
                  {/* Company vs personal, wherever a truck is shown (STI-501).
                      A tool riding a foreman's own truck is the case the
                      departure path cares about. */}
                  {t.currentTruckUnit && t.currentTruckOwnership === "personal_allowance" ? (
                    <span className="ml-1 rounded-sm border border-warn/30 bg-warn-bg px-1 text-[10px] font-medium text-warn">
                      personal
                    </span>
                  ) : null}
                </td>
              ) : null}
              <td className="px-3 py-2.5 text-[12px] text-muted-foreground">{humanize(t.status)}</td>
              <td
                className={cn(
                  "px-3 py-2.5 text-right text-[12px] font-semibold capitalize",
                  CONDITION_TONE[(t.condition ?? "").toLowerCase()] ?? "text-muted-foreground",
                )}
              >
                {t.condition ?? "—"}
              </td>
              {actions ? (
                <td className="px-2 py-2.5 text-right">
                  <ToolMenu assetId={t.id} assetTag={t.tag ?? t.serialNumber ?? "Untagged"} heldBySomeone={!!t.custodianId} />
                </td>
              ) : null}
            </tr>
          ))}
          {visible.length === 0 ? (
            <tr>
              <td className="px-3 py-2.5 text-sm text-muted-foreground" colSpan={colCount}>
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


/* Worst first. Anything unrecognised sorts last — see the null rule below. */
const CONDITION_RANK: Record<string, number> = { damaged: 0, poor: 1, fair: 2, good: 3, new: 4 };

/* Good reads calm, fair wants attention, anything worse is a problem — the
   design's condColor, on this product's reserved status tokens. */
const CONDITION_TONE: Record<string, string> = {
  good: "text-ok",
  new: "text-ok",
  fair: "text-warn",
  poor: "text-crit",
  damaged: "text-crit",
};

type SortKey = "tag" | "name" | "category" | "rides" | "status" | "condition";

/* Nulls sort last in BOTH directions — an untagged tool or one with no value is
   missing data, and missing data belongs at the end whichever way the arrow
   points, not alternately at the top. */
function compare(a: ToolRow, b: ToolRow, key: SortKey): number {
  if (key === "condition") {
    /* Condition sorts by how bad it is, not alphabetically: "Damaged, Fair,
       Good" is the order somebody chasing problems wants, and alphabetically
       that happens to be exactly backwards from useful. */
    const rank = (t: ToolRow) => CONDITION_RANK[(t.condition ?? "").toLowerCase()] ?? 99;
    return rank(a) - rank(b);
  }
  const pick = (t: ToolRow) =>
    key === "tag"
      ? (t.tag ?? t.serialNumber ?? "")
      : key === "name"
        ? formatAssetModel(t)
        : key === "category"
          ? (t.categoryName ?? "")
          : key === "rides"
            ? (t.locationName ?? t.currentTruckUnit ?? t.currentTrailerUnit ?? "")
            : (t.status ?? "");
  const x = pick(a);
  const y = pick(b);
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y, undefined, { numeric: true });
}

function SortHead({
  k,
  sort,
  onSort,
  align,
  className,
  children,
}: {
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (k: SortKey) => void;
  align?: "right";
  className?: string;
  children: React.ReactNode;
}) {
  const active = sort.key === k;
  const Icon = !active ? ChevronsUpDown : sort.desc ? ArrowDown : ArrowUp;
  return (
    <th className={cn("px-3 py-2", align === "right" ? "text-right" : "text-left", className)}>
      <button
        type="button"
        onClick={() => onSort(k)}
        aria-label={`Sort by ${String(children)}`}
        className={cn(
          "label-xs inline-flex items-center gap-1 transition-colors hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {children}
        <Icon className={cn("size-3 shrink-0", active ? "opacity-100" : "opacity-40")} aria-hidden />
      </button>
    </th>
  );
}
