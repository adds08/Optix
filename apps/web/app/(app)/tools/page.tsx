"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Download, Search } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DEFAULT_HIGH_VALUE_THRESHOLD, formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { ToolIcon } from "@/components/sti/tool-icon";
import { FacetGroup, FacetRow, ClearFacets, FilterPills } from "@/components/sti/facets";
import { FlagBadges, isHighValue, warrantyFlag } from "@/components/sti/flags";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { AssetForm, type AssetEditable } from "@/components/asset-form";
import { ToolMenu } from "@/components/tool-menu";
import { BulkMoveForm } from "@/components/bulk-move-form";
import { BulkEditForm } from "@/components/bulk-edit-form";
import { SavedFilters } from "@/components/saved-filters";
import { useJobScope } from "@/components/job-scope";
import { usePermissions } from "@/components/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { FilterSheet } from "@/components/sti/data-table/filter-sheet";
import { downloadCsv } from "@/lib/csv";
import { exportAssetsToSpec } from "@/lib/export-assets";
import { money, idName, assetNumberDisplay } from "@/lib/format";

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
  /* The United-Rentals move: scope the whole register to one job first. When a
     project is picked, every facet count and every list below is within it. */
  const [project, setProject] = useState("all");
  /* The tool being edited, if any. */
  const [editing, setEditing] = useState<AssetEditable | null>(null);
  /* Bulk selection — drives the Move / Return action bar. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  /* Re-filing (category / department) is a separate dialog from moving, so a
     book-keeping edit can never be reached by aiming at the custody one. */
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const { has } = usePermissions();

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

  /* Job scope first: the register is "everything" or "one project" — and for a
     superintendent, always within the jobs their groups are assigned. */
  const { projectIds: scopeProjects } = useJobScope();
  const scoped = useMemo(() => {
    let rows = all;
    if (project !== "all") rows = rows.filter((r) => r.currentProjectId === project);
    if (scopeProjects) {
      rows = rows.filter((r) => (r.currentProjectId ? scopeProjects.has(r.currentProjectId) : false));
    }
    return rows;
  }, [all, project, scopeProjects]);

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

  /* The table view applies the structured filters here and its own search
     inside the DataTable. */
  const filtered = useMemo(() => scoped.filter((r) => matches(r)), [scoped, matches]);

  /* Distinct projects for the scope dropdown, from whatever is in the register. */
  const projectOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of all) {
      if (r.currentProjectId && r.currentProjectName) byId.set(r.currentProjectId, r.currentProjectName);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  /* Selection, keyed by asset id so it survives the table's own pagination. */
  const selectionRecord = useMemo(
    () => Object.fromEntries([...selectedIds].map((id) => [id, true])),
    [selectedIds],
  );
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
        /* The register's own number — every row has one, unlike Tag below.
           Leads the table because it is the one column guaranteed never to
           read "no tag". */
        header: "ID",
        accessorFn: (r) => r.assetNumber,
        width: "6rem",
        cell: (r) => (
          <Link href={`/tools/${r.id}`} className="tag-num hover:underline">
            {assetNumberDisplay(r.assetNumber)}
          </Link>
        ),
      }),
      col<Row>({
        header: "Tag",
        accessorFn: (r) => r.tag ?? "",
        width: "6.5rem",
        cell: (r) => (
          <Link href={`/tools/${r.id}`} className="hover:underline">
            <Tag>{r.tag}</Tag>
          </Link>
        ),
      }),
      col<Row>({
        header: "Tool",
        accessorFn: (r) => formatAssetModel(r),
        /* The category icon rides on the name, not in its own column: a register
           of 400 rows is a wall of text, and the glyph is what lets someone find
           the drills without reading a single word. */
        /* The glyph only earns its place when the row HAS a category. Falling
           back to a wrench for uncategorised tools drew the same icon down the
           whole column — 754 identical marks carrying no information, which is
           worse than none. The space is held either way so the names still
           start on one line. */
        cell: (r) => (
          <Link href={`/tools/${r.id}`} className="group/tool flex items-center gap-2">
            {r.categoryName ? (
              <ToolIcon
                category={r.categoryName}
                className="size-4 shrink-0 text-muted-foreground transition-colors group-hover/tool:text-primary"
              />
            ) : (
              <span aria-hidden className="size-4 shrink-0" />
            )}
            <span className="truncate font-medium group-hover/tool:underline">
              {formatAssetModel(r) || "Untagged tool"}
            </span>
          </Link>
        ),
      }),
      col<Row>({
        header: "Category",
        accessorFn: (r) => r.categoryName ?? "",
        width: "8rem",
        cell: (r) => r.categoryName ?? <span className="text-muted-foreground">—</span>,
      }),
      col<Row>({
        header: "Status",
        accessorFn: (r) => r.status,
        width: "8.5rem",
        cell: (r) => <StatusPill status={r.status} />,
      }),
      col<Row>({
        header: "Holder",
        accessorFn: (r) => r.custodianName ?? "",
        width: "10.5rem",
        cell: (r) => r.custodianName ?? <span className="text-muted-foreground">In the yard</span>,
      }),
      col<Row>({
        header: "Where",
        accessorFn: (r) => r.locationName ?? "",
        width: "7rem",
        cell: (r) => r.locationName ?? <span className="text-muted-foreground">—</span>,
      }),
      col<Row>({
        header: "Project",
        accessorFn: (r) => r.currentProjectName ?? "",
        width: "11rem",
        cell: (r) => (
          <span className="text-muted-foreground">
            {r.currentProjectName ? idName(r.currentProjectExternalId, r.currentProjectName) : "—"}
          </span>
        ),
      }),
      col<Row>({
        header: "Cost",
        accessorFn: (r) => Number(r.acquisitionCost ?? 0),
        numeric: true,
        width: "6.5rem",
        cell: (r) => (
          <span className={isHighValue(r) ? "font-semibold" : "text-muted-foreground"}>
            {money(r.acquisitionCost)}
          </span>
        ),
      }),
      col<Row>({
        header: "Flags",
        sortable: false,
        width: "8rem",
        cell: (r) => <FlagBadges asset={r} />,
      }),
      col<Row>({
        header: "Serial",
        accessorFn: (r) => r.serialNumber ?? "",
        width: "9rem",
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">{r.serialNumber ?? "—"}</span>
        ),
      }),
      col<Row>({
        header: "Charged to",
        accessorFn: (r) => r.owningDepartmentName ?? r.owningProjectName ?? "",
        width: "10rem",
        cell: (r) => r.owningDepartmentName ?? r.owningProjectName ?? <span className="text-muted-foreground">—</span>,
      }),
      col<Row>({
        id: "actions",
        header: "",
        enableHiding: false,
        width: "3.5rem",
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

  /* Optional columns start hidden; the DataTable's Columns menu restores them.
     Serial used to be one of them — now shown by default, since a manufacturer
     serial is real, verified data and the register should surface it wherever
     it exists rather than bury it behind a menu. */
  const initialHidden = useMemo(
    () => Object.fromEntries(["Flags", "Charged to"].map((h) => [h, false])),
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

  /* The shape a saved view round-trips: plain values, JSON-serialisable. */
  const registerCurrent = useMemo(
    () => ({ project, category, status, flags: [...flags] }),
    [project, category, status, flags],
  );
  const applySaved = (f: Record<string, unknown>) => {
    setProject(typeof f.project === "string" ? f.project : "all");
    setCategory(typeof f.category === "string" ? f.category : "all");
    setStatus(typeof f.status === "string" ? f.status : "all");
    const savedFlags = Array.isArray(f.flags)
      ? (f.flags as unknown[]).filter((x): x is FlagKey => typeof x === "string" && x in FLAG_LABELS)
      : [];
    setFlags(new Set(savedFlags));
  };

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
      {bulkEditOpen ? (
        <BulkEditForm
          open
          onClose={() => setBulkEditOpen(false)}
          assetIds={[...selectedIds]}
          onApplied={() => setSelectedIds(new Set())}
        />
      ) : null}
      <div className="flex flex-col gap-3">
        {/* One toolbar: job scope, search, the filter sheet (the former facet
            rail), and the saved-view menu. */}
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
              move. Everything below (facets, exports) is within it. */}
          <SearchSelect
            value={project === "all" ? "" : project}
            onChange={(v) => setProject(v === "" ? "all" : v)}
            placeholder="All projects"
            widthClass="w-56"
            options={projectOptions.map(([id, name]) => ({ value: id, label: name }))}
          />
          <FilterSheet
            title="Filter the register"
            activeCount={filterCount}
            onApply={() => {}}
            onClear={clearAll}
          >
            {facetControls}
          </FilterSheet>
          <span className="text-sm text-muted-foreground">
            <span className="tnum font-medium text-foreground">{filtered.length}</span>
            {filtered.length !== scoped.length ? <> of <span className="tnum">{scoped.length}</span></> : null} tools
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ImportButton entity="asset" />
            <Button
              size="sm"
              variant="outline"
              onClick={exportAll}
              disabled={!all.length}
              title="Exports the register in the same columns the importer reads, so the file round-trips"
            >
              <Download className="size-4" aria-hidden />
              Export
            </Button>
            <CreateAction perm="asset.manage" label="New tool" Form={AssetForm} />
            <SavedFilters
              storageKey="tool-register"
              current={registerCurrent}
              onApply={applySaved}
              hasActive={filtering}
              onClear={clearAll}
            />
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
              {/* STI-104. `asset.manage`, not a custody permission — re-filing
                  changes the books, not who holds the tool. */}
              {has("asset.manage") ? (
                <Button size="sm" variant="outline" onClick={() => setBulkEditOpen(true)}>
                  Re-file…
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
        ) : !filtered.length ? (
          <EmptyState
            icon={Boxes}
            title={filtering ? "No tools match" : "No tools registered yet"}
            description={
              filtering
                ? "Try a different search, or clear a filter in the sheet."
                : "Import the existing fleet, or register the first tool to start the custody chain."
            }
          />
        ) : (
          <DataTable<Row>
            mode="client"
            columns={TABLE_COLUMNS}
            rows={filtered}
            rowId={(r) => r.id}
            /* The register carries the most columns of any table here. Below
               this the name column gets squeezed to nothing, so the wrapper
               scrolls sideways instead. Bumped when ID and Serial joined the
               default-visible set — same headroom rule, just two columns
               wider now. */
            minWidth="1460px"
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
