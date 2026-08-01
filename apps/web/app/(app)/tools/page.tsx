"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, Boxes, Columns3, Download, LayoutGrid, Rows3 } from "lucide-react";
import { DEFAULT_HIGH_VALUE_THRESHOLD, formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, TableWrap } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { FacetRail, FacetGroup, FacetRow, ClearFacets, FilterPills } from "@/components/sti/facets";
import { FlagBadges, isHighValue, warrantyFlag } from "@/components/sti/flags";
import { AssetCard } from "@/components/sti/asset-card";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { AssetForm, type AssetEditable } from "@/components/asset-form";
import { ToolMenu } from "@/components/tool-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadCsv } from "@/lib/csv";
import { exportAssetsToSpec } from "@/lib/export-assets";
import { money, photoUrl } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUSES = ["available", "assigned", "in_maintenance", "reserved", "lost"] as const;
type FlagKey = "high_value" | "warranty" | "no_project";

const FLAG_LABELS: Record<FlagKey, string> = {
  high_value: "High value",
  warranty: "Warranty ending",
  no_project: "No project",
};

/* One predicate per flag, so adding a third one did not mean extending a
   ternary that already read as a puzzle. */
function flagged(r: { currentProjectId?: string | null }, f: FlagKey): boolean {
  if (f === "high_value") return isHighValue(r as Parameters<typeof isHighValue>[0]);
  if (f === "warranty") return !!warrantyFlag(r as Parameters<typeof warrantyFlag>[0]);
  return !r.currentProjectId;
}

/*
  Only `search` is sent to the API. Category, status and flags are applied here
  on the client, because the facet counts have to be computed from the unfiltered
  set — asking the server for one status would throw away the numbers needed to
  label every other option. Worth revisiting if a tenant's fleet outgrows a
  single fetch; `asset.list` already accepts the filters when that day comes.
*/
export default function ToolsPage() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<string>("all");
  const [flags, setFlags] = useState<Set<FlagKey>>(new Set());
  const [mode, setMode] = useState<"cards" | "table">("cards");
  /* The tool being edited, if any. */
  const [editing, setEditing] = useState<AssetEditable | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const utils = trpc.useUtils();

  const remove = trpc.asset.delete.useMutation({
    onSuccess: () => {
      setFailed(null);
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
    },
    /* The router refuses anything carrying history and says what to do
       instead. That sentence is the useful part — show it on the row. */
    onError: (e, vars) => setFailed({ id: vars.id, message: e.message }),
  });

  const list = trpc.asset.list.useQuery({ search: q.trim() || undefined });
  const all = useMemo(() => list.data ?? [], [list.data]);

  const matches = useMemo(() => {
    /* `skip` lifts one filter so a facet can count its own options. */
    return (r: (typeof all)[number], skip?: "category" | "status" | "flags") => {
      if (skip !== "category" && category !== "all" && (r.categoryName ?? "") !== category) return false;
      if (skip !== "status" && status !== "all" && r.status !== status) return false;
      if (skip !== "flags") {
        if (flags.has("high_value") && !isHighValue(r)) return false;
        if (flags.has("warranty") && !warrantyFlag(r)) return false;
        /* Not an error state — a tool between jobs, or sitting in the yard. It
           is a filter because "what are we holding that no job is paying for"
           was previously only answerable one row at a time. */
        if (flags.has("no_project") && r.currentProjectId) return false;
      }
      return true;
    };
  }, [category, status, flags]);

  const rows = useMemo(() => all.filter((r) => matches(r)), [all, matches]);

  /*
    Columns as data, so sorting and hiding are one mechanism rather than nine
    special cases. `sortValue` is separate from `cell` because what you read and
    what you order by are not the same thing — a status pill sorts by its raw
    value, a cost sorts as a number and not as "$1,299.00".
  */
  type Row = (typeof all)[number];
  type Col = {
    key: string;
    label: string;
    cell: (r: Row) => React.ReactNode;
    sortValue?: (r: Row) => string | number;
    numeric?: boolean;
    sortable?: boolean;
    /* Off unless asked for. The table showed nine columns at once and the ones
       that answer "where is it and who has it" were competing with serial
       numbers nobody scans down. */
    optional?: boolean;
  };

  const COLUMNS: Col[] = useMemo(
    () => [
      {
        key: "tag",
        label: "Tag",
        sortValue: (r) => r.tag ?? "",
        cell: (r) => (
          <Link href={`/tools/${r.id}`} className="hover:underline">
            <Tag>{r.tag}</Tag>
          </Link>
        ),
      },
      {
        key: "model",
        label: "Tool",
        sortValue: (r) => formatAssetModel(r),
        cell: (r) => (
          <Link href={`/tools/${r.id}`} className="font-medium hover:underline">
            {formatAssetModel(r) || "Untagged tool"}
          </Link>
        ),
      },
      {
        key: "category",
        label: "Category",
        sortValue: (r) => r.categoryName ?? "",
        cell: (r) => r.categoryName ?? <span className="text-muted-foreground">—</span>,
      },
      {
        key: "status",
        label: "Status",
        sortValue: (r) => r.status,
        cell: (r) => <StatusPill status={r.status} />,
      },
      {
        key: "holder",
        label: "Holder",
        sortValue: (r) => r.custodianName ?? "",
        cell: (r) => r.custodianName ?? <span className="text-muted-foreground">In the yard</span>,
      },
      {
        key: "location",
        label: "Where",
        sortValue: (r) => r.locationName ?? "",
        cell: (r) => r.locationName ?? <span className="text-muted-foreground">—</span>,
      },
      {
        key: "project",
        label: "Project",
        sortValue: (r) => r.currentProjectName ?? "",
        cell: (r) => r.currentProjectName ?? <span className="text-muted-foreground">—</span>,
      },
      {
        key: "cost",
        label: "Cost",
        numeric: true,
        sortValue: (r) => Number(r.acquisitionCost ?? 0),
        cell: (r) => (
          <span className={isHighValue(r) ? "font-semibold" : "text-muted-foreground"}>
            {money(r.acquisitionCost)}
          </span>
        ),
      },
      {
        key: "flags",
        label: "Flags",
        sortable: false,
        optional: true,
        cell: (r) => <FlagBadges asset={r} />,
      },
      {
        key: "serial",
        label: "Serial",
        optional: true,
        sortValue: (r) => r.serialNumber ?? "",
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">{r.serialNumber ?? "—"}</span>
        ),
      },
      {
        key: "owning",
        label: "Charged to",
        optional: true,
        sortValue: (r) => r.owningDepartmentName ?? r.owningProjectName ?? "",
        cell: (r) => r.owningDepartmentName ?? r.owningProjectName ?? <span className="text-muted-foreground">—</span>,
      },
    ],
    [],
  );

  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(COLUMNS.filter((c) => c.optional).map((c) => c.key)),
  );
  const visibleCols = COLUMNS.filter((c) => !hidden.has(c.key));

  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "tag", dir: "asc" });
  const toggleSort = (key: string) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      /* Empty cells last whichever way the column is pointing — a blank is not
         a value that belongs at the top of an ascending sort. */
      const as = String(av);
      const bs = String(bv);
      if (!as && bs) return 1;
      if (as && !bs) return -1;
      return as.localeCompare(bs) * dir;
    });
  }, [rows, sort, COLUMNS]);

  const categories = useMemo(
    () => Array.from(new Set(all.map((r) => r.categoryName).filter((c): c is string => !!c))).sort(),
    [all],
  );

  const countBy = {
    category: (c: string) => all.filter((r) => (r.categoryName ?? "") === c && matches(r, "category")).length,
    anyCategory: () => all.filter((r) => matches(r, "category")).length,
    status: (s: string) => all.filter((r) => r.status === s && matches(r, "status")).length,
    anyStatus: () => all.filter((r) => matches(r, "status")).length,
    flag: (f: FlagKey) =>
      all.filter((r) => flagged(r, f) && matches(r, "flags")).length,
  };

  const toggleFlag = (f: FlagKey) =>
    setFlags((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const clearAll = () => {
    setCategory("all");
    setStatus("all");
    setFlags(new Set());
  };

  /* The spec-driven export — the one that round-trips. It emits the import
     spec's own columns (names for refs, raw numbers), so exporting the register
     and re-importing it creates no new rows. Deliberately separate from
     ReportTable's pretty export. */
  const exportAll = () => {
    const rows = all.map((r) => ({
      tag: r.tag,
      make: r.make,
      modelNumber: r.modelNumber,
      description: r.description,
      categoryName: r.categoryName,
      serialNumber: r.serialNumber,
      quantity: r.quantity,
      acquisitionCost: r.acquisitionCost,
      acquisitionDate: r.acquisitionDate,
      warrantyExpiresOn: r.warrantyExpiresOn,
      condition: r.condition,
      otherRef: r.otherRef ?? null,
      locationName: r.locationName,
      owningProjectName: r.owningProjectName,
    }));
    downloadCsv(`stinventory-assets-export-${new Date().toISOString().slice(0, 10)}`, exportAssetsToSpec(rows));
  };

  const filtering = category !== "all" || status !== "all" || flags.size > 0;

  const pills = [
    ...(category !== "all" ? [{ key: "cat", label: category, onRemove: () => setCategory("all") }] : []),
    ...(status !== "all" ? [{ key: "st", label: humanize(status), onRemove: () => setStatus("all") }] : []),
    ...Array.from(flags).map((f) => ({
      key: f,
      label: FLAG_LABELS[f],
      onRemove: () => toggleFlag(f),
    })),
  ];

  /* One shape for the edit dialog, used by the card menu and the table. */
  const editableFrom = (r: (typeof all)[number]): AssetEditable => ({
    id: r.id,
    tag: r.tag ?? "",
    make: r.make,
    modelNumber: r.modelNumber,
    description: r.description,
    categoryName: r.categoryName,
    photoKey: r.photoKey,
    serialNumber: r.serialNumber,
    quantity: r.quantity,
    acquisitionCost: r.acquisitionCost,
    acquisitionDate: r.acquisitionDate,
    condition: r.condition,
    owningProjectId: r.owningProjectId,
    costTarget: (r.costTarget ?? "project") as AssetEditable["costTarget"],
    owningDepartmentId: r.owningDepartmentId,
  });

  const menuFor = (r: (typeof all)[number]) => (
    <ToolMenu
      assetId={r.id}
      assetTag={r.tag ?? "Untagged tool"}
      heldBySomeone={!!r.custodianId}
      onEdit={() => setEditing(editableFrom(r))}
      onDelete={() => remove.mutate({ id: r.id })}
      deleting={remove.isPending && failed?.id !== r.id}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {editing ? <AssetForm open onClose={() => setEditing(null)} edit={editing} /> : null}
      <PageHeader
        eyebrow="Equipment"
        title="Tool Register"
        description="Every serialized tool and bulk line the company owns. Open one to see its full custody chain."
        actions={
          <>
            <ImportButton entity="asset" />
            <Button size="sm" variant="outline" onClick={exportAll} disabled={!all.length} title="Exports the register in the same columns the importer reads, so the file round-trips">
              <Download className="size-4" aria-hidden />
              Export
            </Button>
            <CreateAction perm="asset.manage" label="New tool" Form={AssetForm} />
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[13rem_1fr] lg:items-start">
        <FacetRail className="lg:sticky lg:top-4">
          <FacetGroup title="Category">
            <FacetRow label="All categories" count={countBy.anyCategory()} active={category === "all"} onClick={() => setCategory("all")} />
            {categories.map((c) => (
              <FacetRow key={c} label={c} count={countBy.category(c)} active={category === c} indent onClick={() => setCategory(c)} />
            ))}
          </FacetGroup>

          <FacetGroup title="Status">
            <FacetRow label="Any status" count={countBy.anyStatus()} active={status === "all"} onClick={() => setStatus("all")} />
            {STATUSES.map((s) => (
              <FacetRow key={s} label={humanize(s)} count={countBy.status(s)} active={status === s} indent onClick={() => setStatus(s)} />
            ))}
          </FacetGroup>

          <FacetGroup title="Flags">
            <FacetRow
              label={`High value (≥ ${money(DEFAULT_HIGH_VALUE_THRESHOLD)})`}
              count={countBy.flag("high_value")}
              active={flags.has("high_value")}
              onClick={() => toggleFlag("high_value")}
            />
            <FacetRow
              label="No project"
              count={countBy.flag("no_project")}
              active={flags.has("no_project")}
              onClick={() => toggleFlag("no_project")}
            />
            <FacetRow
              label="Warranty ending / expired"
              count={countBy.flag("warranty")}
              active={flags.has("warranty")}
              onClick={() => toggleFlag("warranty")}
            />
          </FacetGroup>

          {filtering ? <ClearFacets onClick={clearAll} /> : null}
        </FacetRail>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by tag, model or serial…"
              className="max-w-sm"
              aria-label="Search tools"
            />
            <span className="text-sm text-muted-foreground">
              <span className="tnum font-medium text-foreground">{rows.length}</span>
              {rows.length !== all.length ? <> of <span className="tnum">{all.length}</span></> : null} tools
            </span>

            {/* Column control belongs to the table, so it only exists there. */}
            {mode === "table" ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="ml-auto flex items-center gap-1.5 rounded-sm border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent">
                  <Columns3 className="size-3.5" aria-hidden />
                  Columns
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Show</DropdownMenuLabel>
                  {COLUMNS.map((c) => {
                    const shown = !hidden.has(c.key);
                    return (
                      <DropdownMenuItem
                        key={c.key}
                        onSelect={(e) => {
                          /* Keep it open — picking columns is several decisions,
                             not one. */
                          e.preventDefault();
                          setHidden((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.key)) next.delete(c.key);
                            else next.add(c.key);
                            return next;
                          });
                        }}
                      >
                        <span
                          className={cn(
                            "flex size-3.5 items-center justify-center rounded-[3px] border text-[9px]",
                            shown ? "border-primary bg-primary text-primary-foreground" : "border-input",
                          )}
                          aria-hidden
                        >
                          {shown ? "\u2713" : ""}
                        </span>
                        {c.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

            <div className={cn("flex overflow-hidden rounded-sm border", mode !== "table" && "ml-auto")} role="group" aria-label="View mode">
              {([["cards", "Cards", LayoutGrid], ["table", "Table", Rows3]] as const).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMode(k)}
                  aria-pressed={mode === k}
                  /* A segmented control, not a call to action. Which view you
                     are in is minor state; a filled brand button gave it more
                     weight than the tools it was showing. */
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors",
                    mode === k
                      ? "bg-muted font-medium text-foreground"
                      : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <FilterPills pills={pills} />

          {list.isLoading ? (
            <TableSkeleton cols={6} />
          ) : list.isError ? (
            <ErrorNote message="The tool register could not be loaded. Check that the API is running, then reload." />
          ) : !rows.length ? (
            <EmptyState
              icon={Boxes}
              title={q || filtering ? "No tools match" : "No tools registered yet"}
              description={
                q || filtering
                  ? "Try a different search, or clear a filter in the left rail."
                  : "Import the existing fleet, or register the first tool to start the custody chain."
              }
            />
          ) : mode === "cards" ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {rows.map((r) => (
                <AssetCard key={r.id} row={{ ...r, photoUrl: photoUrl(r.photoKey) }} actions={menuFor(r)} />
              ))}
            </div>
          ) : (
            <TableWrap>
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b">
                    {visibleCols.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        className={cn(
                          "label-xs whitespace-nowrap px-3 py-2 text-left font-medium",
                          c.numeric && "text-right",
                        )}
                      >
                        {c.sortable === false ? (
                          c.label
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleSort(c.key)}
                            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                          >
                            {c.label}
                            <ArrowUpDown
                              className={cn(
                                "size-3",
                                sort.key === c.key ? "text-foreground" : "text-muted-foreground/40",
                              )}
                              aria-hidden
                            />
                            <span className="sr-only">
                              {sort.key === c.key
                                ? `sorted ${sort.dir === "asc" ? "ascending" : "descending"}`
                                : "not sorted"}
                            </span>
                          </button>
                        )}
                      </th>
                    ))}
                    <th scope="col" className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const heavy = isHighValue(r);
                    return (
                      <tr
                        key={r.id}
                        /* Zebra rather than a rule under every row: at this
                           density the lines were doing more work than the data. */
                        className="border-b border-border/40 last:border-0 odd:bg-muted/20 hover:bg-accent/40"
                      >
                        {visibleCols.map((c) => (
                          <td
                            key={c.key}
                            className={cn(
                              "px-3 py-2 align-middle",
                              c.numeric && "text-right tnum",
                              c.key === "tag" && heavy && "shadow-[inset_2px_0_0_var(--primary)]",
                            )}
                          >
                            {c.cell(r)}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-right">
                          <ToolMenu
                            assetId={r.id}
                            assetTag={r.tag ?? "Untagged tool"}
                            heldBySomeone={!!r.custodianId}
                            onEdit={() => setEditing(editableFrom(r))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </div>
      </div>
    </div>
  );
}
