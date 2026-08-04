"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Download, LayoutGrid, Rows3, Search } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DEFAULT_HIGH_VALUE_THRESHOLD, formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { FacetGroup, FacetRow, ClearFacets, FilterPills } from "@/components/sti/facets";
import { FlagBadges, isHighValue, warrantyFlag } from "@/components/sti/flags";
import { AssetCard } from "@/components/sti/asset-card";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { AssetForm, type AssetEditable } from "@/components/asset-form";
import { ToolMenu } from "@/components/tool-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { FilterSheet } from "@/components/sti/data-table/filter-sheet";
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

function matchesText(r: { tag: string | null; make: string | null; modelNumber: string | null; description: string | null; serialNumber: string | null }, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [r.tag, r.make, r.modelNumber, r.description, r.serialNumber]
    .some((v) => v?.toLowerCase().includes(needle));
}

/*
  Only search is sent to the API. Category, status and flags are applied here
  on the client, because the facet counts have to be computed from the unfiltered
  set — asking the server for one status would throw away the numbers needed to
  label every other option. Worth revisiting if a tenant's fleet outgrows a
  single fetch; `asset.list` already accepts the filters when that day comes.

  The facet rail now lives inside the filter sheet: same controls, same
  counts, same behaviour — but the rail no longer eats a third of the
  register's width (docs/19).
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

  const list = trpc.asset.list.useQuery();
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

  /* Facets only — the table view's search is the DataTable's own; the cards
     view applies `matchesText` here. */
  const filtered = useMemo(() => all.filter((r) => matches(r)), [all, matches]);
  const cards = useMemo(() => filtered.filter((r) => matchesText(r, q)), [filtered, q]);

  type Row = (typeof all)[number];

  const TABLE_COLUMNS: ColumnDef<Row>[] = useMemo(
    () => [
      col<Row>({
        header: "Tag",
        accessorFn: (r) => r.tag ?? "",
        cell: (r) => (
          <Link href={`/tools/${r.id}`} className="hover:underline">
            <Tag>{r.tag}</Tag>
          </Link>
        ),
      }),
      col<Row>({
        header: "Tool",
        accessorFn: (r) => formatAssetModel(r),
        cell: (r) => (
          <Link href={`/tools/${r.id}`} className="font-medium hover:underline">
            {formatAssetModel(r) || "Untagged tool"}
          </Link>
        ),
      }),
      col<Row>({
        header: "Category",
        accessorFn: (r) => r.categoryName ?? "",
        cell: (r) => r.categoryName ?? <span className="text-muted-foreground">—</span>,
      }),
      col<Row>({
        header: "Status",
        accessorFn: (r) => r.status,
        cell: (r) => <StatusPill status={r.status} />,
      }),
      col<Row>({
        header: "Holder",
        accessorFn: (r) => r.custodianName ?? "",
        cell: (r) => r.custodianName ?? <span className="text-muted-foreground">In the yard</span>,
      }),
      col<Row>({
        header: "Where",
        accessorFn: (r) => r.locationName ?? "",
        cell: (r) => r.locationName ?? <span className="text-muted-foreground">—</span>,
      }),
      col<Row>({
        header: "Project",
        accessorFn: (r) => r.currentProjectName ?? "",
        cell: (r) => r.currentProjectName ?? <span className="text-muted-foreground">—</span>,
      }),
      col<Row>({
        header: "Cost",
        accessorFn: (r) => Number(r.acquisitionCost ?? 0),
        numeric: true,
        cell: (r) => (
          <span className={isHighValue(r) ? "font-semibold" : "text-muted-foreground"}>
            {money(r.acquisitionCost)}
          </span>
        ),
      }),
      col<Row>({
        header: "Flags",
        sortable: false,
        cell: (r) => <FlagBadges asset={r} />,
      }),
      col<Row>({
        header: "Serial",
        accessorFn: (r) => r.serialNumber ?? "",
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">{r.serialNumber ?? "—"}</span>
        ),
      }),
      col<Row>({
        header: "Charged to",
        accessorFn: (r) => r.owningDepartmentName ?? r.owningProjectName ?? "",
        cell: (r) => r.owningDepartmentName ?? r.owningProjectName ?? <span className="text-muted-foreground">—</span>,
      }),
      col<Row>({
        id: "actions",
        header: "",
        enableHiding: false,
        cell: (r) => (
          <ToolMenu
            assetId={r.id}
            assetTag={r.tag ?? "Untagged tool"}
            heldBySomeone={!!r.custodianId}
            onEdit={() => setEditing(editableFrom(r))}
          />
        ),
      }),
    ],
    [],
  );

  /* Optional columns start hidden; the DataTable's Columns menu restores them. */
  const initialHidden = useMemo(
    () => Object.fromEntries(["Flags", "Serial", "Charged to"].map((h) => [h, false])),
    [],
  );

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
  const filterCount = (category !== "all" ? 1 : 0) + (status !== "all" ? 1 : 0) + flags.size;

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

  const facetControls = (
    <>
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
    </>
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

      <div className="flex flex-col gap-3">
        {/* One toolbar for both views: search, the filter sheet (the former
            facet rail), and the cards/table toggle. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by tag, model or serial…"
              className="pl-8"
              aria-label="Search tools"
            />
          </div>
          <FilterSheet
            title="Filter the register"
            activeCount={filterCount}
            onApply={() => {}}
            onClear={clearAll}
          >
            {facetControls}
          </FilterSheet>
          <span className="text-sm text-muted-foreground">
            <span className="tnum font-medium text-foreground">{cards.length}</span>
            {cards.length !== all.length ? <> of <span className="tnum">{all.length}</span></> : null} tools
          </span>
          <div className={cn("ml-auto flex overflow-hidden rounded-sm border")} role="group" aria-label="View mode">
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
        ) : !cards.length ? (
          <EmptyState
            icon={Boxes}
            title={q || filtering ? "No tools match" : "No tools registered yet"}
            description={
              q || filtering
                ? "Try a different search, or clear a filter in the sheet."
                : "Import the existing fleet, or register the first tool to start the custody chain."
            }
          />
        ) : mode === "cards" ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {cards.map((r) => (
              <AssetCard key={r.id} row={{ ...r, photoUrl: photoUrl(r.photoKey) }} actions={menuFor(r)} />
            ))}
          </div>
        ) : (
          <DataTable<Row>
            mode="client"
            columns={TABLE_COLUMNS}
            rows={filtered}
            rowId={(r) => r.id}
            filterPredicate={matches}
            searchValue={q}
            onSearchChange={setQ}
            showToolbar={false}
            columnVisibilityInitial={initialHidden}
            emptyTitle="No tools match"
            emptyDescription="Try a different search, or clear a filter in the sheet."
          />
        )}
      </div>
    </div>
  );
}
