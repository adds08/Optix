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
import { BulkMoveForm } from "@/components/bulk-move-form";
import { usePermissions } from "@/components/use-permissions";
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
  /* The United-Rentals move: scope the whole register to one job first. When a
     project is picked, every facet count and every list below is within it. */
  const [project, setProject] = useState("all");
  /* Group the register by how the crew actually thinks about tools. */
  const [groupBy, setGroupBy] = useState<"none" | "foreman" | "project" | "truck" | "trailer">("none");
  /* The tool being edited, if any. */
  const [editing, setEditing] = useState<AssetEditable | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  /* Bulk selection — a Set of asset ids, shared between the cards and table
     views, driving the Move / Return action bar. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const { has } = usePermissions();

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

  /* One mutation for a bulk return; the form owns the bulk move. */
  const returnBulk = trpc.action.submit.useMutation({
    onSuccess: () => {
      utils.asset.list.invalidate();
      utils.assignment.list.invalidate();
      utils.transfer.list.invalidate();
      utils.dashboard.kpis.invalidate();
      utils.dashboard.pendingApprovals.invalidate();
      utils.dashboard.recentActivity.invalidate();
    },
  });

  /* `action.submit` chunks at 50, so a bigger selection is returned in
     sequential batches. Each tool writes its own `return` transaction. */
  const bulkReturn = async () => {
    const ids = [...selectedIds];
    setBulkError(null);
    try {
      for (let i = 0; i < ids.length; i += 50) {
        await returnBulk.mutateAsync({
          type: "return",
          assetIds: ids.slice(i, i + 50),
          note: "Returned in bulk from the register",
        });
      }
      setSelectedIds(new Set());
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Could not return those tools. Try again.");
    }
  };

  const list = trpc.asset.list.useQuery();
  const all = useMemo(() => list.data ?? [], [list.data]);

  /* Job scope first: the register is "everything" or "one project". */
  const scoped = useMemo(() => {
    if (project === "all") return all;
    return all.filter((r) => r.currentProjectId === project);
  }, [all, project]);

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
  const filtered = useMemo(() => scoped.filter((r) => matches(r)), [scoped, matches]);
  const cards = useMemo(() => filtered.filter((r) => matchesText(r, q)), [filtered, q]);

  /* Distinct projects for the scope dropdown, from whatever is in the register. */
  const projectOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of all) {
      if (r.currentProjectId && r.currentProjectName) byId.set(r.currentProjectId, r.currentProjectName);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  /* Grouped view: cards, but sectioned by the dimension the user picked. */
  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const byKey = new Map<string, { key: string; label: string; rows: (typeof all)[number][] }>();
    for (const r of cards) {
      let key = "other";
      let label = "Not on a truck";
      if (groupBy === "foreman") {
        key = r.custodianId ?? "yard";
        label = r.custodianName ?? "In the yard";
      } else if (groupBy === "project") {
        key = r.currentProjectId ?? "none";
        label = r.currentProjectName ?? "No project";
      } else if (groupBy === "truck") {
        if (r.vehicleType === "truck") {
          key = r.locationId ?? "none";
          label = r.locationName ?? "Unknown truck";
        } else {
          key = "not-truck";
          label = "Not on a truck";
        }
      } else if (groupBy === "trailer") {
        if (r.vehicleType === "trailer") {
          key = r.locationId ?? "none";
          label = r.locationName ?? "Unknown trailer";
        } else {
          key = "not-trailer";
          label = "Not on a trailer";
        }
      }
      const g = byKey.get(key);
      if (g) g.rows.push(r);
      else byKey.set(key, { key, label, rows: [r] });
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [cards, groupBy]);

  /* Selection, keyed by asset id so it survives the cards/table switch and
     the table's own pagination. */
  const selectionRecord = useMemo(
    () => Object.fromEntries([...selectedIds].map((id) => [id, true])),
    [selectedIds],
  );
  const toggleSelected = (id: string, on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const selectedLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of all) {
      if (selectedIds.has(r.id)) out[r.id] = r.tag ?? formatAssetModel(r) ?? "Untagged tool";
    }
    return out;
  }, [all, selectedIds]);

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
    category: (c: string) => scoped.filter((r) => (r.categoryName ?? "") === c && matches(r, "category")).length,
    anyCategory: () => scoped.filter((r) => matches(r, "category")).length,
    status: (s: string) => scoped.filter((r) => r.status === s && matches(r, "status")).length,
    anyStatus: () => scoped.filter((r) => matches(r, "status")).length,
    flag: (f: FlagKey) =>
      scoped.filter((r) => flagged(r, f) && matches(r, "flags")).length,
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
      {bulkOpen ? (
        <BulkMoveForm
          open
          onClose={() => setBulkOpen(false)}
          assetIds={[...selectedIds]}
          assetLabels={selectedLabels}
          onApplied={() => setSelectedIds(new Set())}
        />
      ) : null}
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
        {/* One toolbar for both views: job scope, search, the filter sheet
            (the former facet rail), and the cards/table toggle. */}
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
          {/* Scope the whole register to one job first — the United Rentals
              move. Everything below (facets, groups, exports) is within it. */}
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            aria-label="Filter by project"
            className="flex h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="all">All projects</option>
            {projectOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
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
            {cards.length !== scoped.length ? <> of <span className="tnum">{scoped.length}</span></> : null} tools
          </span>
          <div className="ml-auto flex items-center gap-2">
            {/* Group the register by how the crew actually thinks about tools:
                the foreman carrying them, the job, or the truck/trailer they
                ride in. Grouping renders cards in sections with a per-group
                select, so "move this whole trailer" is a few clicks. */}
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
              aria-label="Group tools by"
              className="flex h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="none">No grouping</option>
              <option value="foreman">Group by foreman</option>
              <option value="project">Group by project</option>
              <option value="truck">Group by truck</option>
              <option value="trailer">Group by trailer</option>
            </select>
            <div className="flex overflow-hidden rounded-sm border" role="group" aria-label="View mode">
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
        </div>

        <FilterPills pills={pills} />

        {/* Bulk action bar — appears only once something is selected. The move
            goes through the same `action.submit` executor as the chat path, so
            every tool writes its own transaction and the high-value approval
            gate still applies per tool. */}
        {selectedIds.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="text-sm font-medium">
              {selectedIds.size} tool{selectedIds.size === 1 ? "" : "s"} selected
            </span>
            <div className="ml-auto flex items-center gap-2">
              {has("transfer.create") ? (
                <Button size="sm" onClick={() => { setBulkError(null); setBulkOpen(true); }}>
                  Move…
                </Button>
              ) : null}
              {has("assignment.create") ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={bulkReturn}
                  disabled={returnBulk.isPending}
                >
                  {returnBulk.isPending ? "Returning…" : "Return to yard"}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </div>
            {bulkError ? (
              <p className="w-full text-xs text-destructive">{bulkError}</p>
            ) : null}
          </div>
        ) : null}

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
        ) : groups ? (
          /* Grouped cards: sections headed by the dimension the user picked.
             Each header carries a "Select group" that pulls the whole section
             into the bulk bar, so moving an entire trailer's contents is a
             few clicks. */
          <div className="flex flex-col gap-6">
            {groups.map((g) => {
              const allSelected = g.rows.every((r) => selectedIds.has(r.id));
              const someSelected = g.rows.some((r) => selectedIds.has(r.id));
              return (
                <section key={g.key} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 border-b pb-1.5">
                    <h3 className="text-sm font-semibold">
                      {g.label}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{g.rows.length}</span>
                    </h3>
                    <div className="ml-auto flex items-center gap-1.5">
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                        <input
                          type="checkbox"
                          role="checkbox"
                          checked={allSelected}
                          onChange={() => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              for (const r of g.rows) {
                                if (allSelected) next.delete(r.id);
                                else next.add(r.id);
                              }
                              return next;
                            });
                          }}
                          className="size-3.5 accent-primary"
                        />
                        {someSelected && !allSelected ? "Some selected" : "Select"}
                      </label>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {g.rows.map((r) => (
                      <AssetCard
                        key={r.id}
                        row={{ ...r, photoUrl: photoUrl(r.photoKey) }}
                        actions={menuFor(r)}
                        selected={selectedIds.has(r.id)}
                        onSelectChange={(on) => toggleSelected(r.id, on)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : mode === "cards" ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {cards.map((r) => (
              <AssetCard
                key={r.id}
                row={{ ...r, photoUrl: photoUrl(r.photoKey) }}
                actions={menuFor(r)}
                selected={selectedIds.has(r.id)}
                onSelectChange={(on) => toggleSelected(r.id, on)}
              />
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
            enableSelection
            selection={selectionRecord}
            onSelectionChange={(sel) => setSelectedIds(new Set(Object.keys(sel)))}
            emptyTitle="No tools match"
            emptyDescription="Try a different search, or clear a filter in the sheet."
          />
        )}
      </div>
    </div>
  );
}
