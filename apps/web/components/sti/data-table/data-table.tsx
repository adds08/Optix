"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Download,
  Eye,
  Search,
} from "lucide-react";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  flexRender,
} from "@tanstack/react-table";
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/sti/page";
import { DataTablePagination } from "./pagination";
import { FilterSheet } from "./filter-sheet";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

/*
  The one table component for the data-heavy pages.

  Two modes:
  - `client`: TanStack sorts, searches and pages in memory. Structured filters
    (status, category, flags) come through `filterPredicate`, applied before
    the table sees the rows — so search still works inside the filtered set.
  - `server`: the page owns `state` and `onStateChange`; sorting and paging
    round-trip to a paginated tRPC procedure (`{ rows, total }`), and the
    footer shows the true total. Global search in server mode is part of the
    state and travels to the server too.

  Column visibility is per-table UI state; export writes the currently shown
  rows (client mode) or the current page (server mode) to CSV.
*/

export type DataTableServerState = {
  page: number;
  pageSize: number;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  search?: string;
};

type Props<T> = {
  columns: ColumnDef<T>[];
  rows: T[];
  mode?: "client" | "server";
  rowId: (row: T) => string;
  /* Client mode only: structured filters applied before search/sort/page. */
  filterPredicate?: (row: T) => boolean;
  /* Server mode only: controlled state. */
  state?: DataTableServerState;
  onStateChange?: (s: DataTableServerState) => void;
  rowCount?: number;
  /* Filters in the sheet — rendered as the sheet's children. */
  filterSheetTitle?: string;
  filterControls?: React.ReactNode;
  filterActiveCount?: number;
  onApplyFilters?: () => void;
  onClearFilters?: () => void;
  toolbarExtra?: React.ReactNode;
  searchPlaceholder?: string;
  /* Controlled search — the page renders its own toolbar (shared with a
     non-table view) and drives this component's search. */
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  /* Renders only the table + pagination when the page owns the toolbar. */
  showToolbar?: boolean;
  /* Columns that start hidden (keyed by column id). */
  columnVisibilityInitial?: Record<string, boolean>;
  /* Row selection. When enabled the table prepends a checkbox column and the
     parent owns the selection (keyed by `rowId`), so the page can run bulk
     actions across rows and views. */
  enableSelection?: boolean;
  selection?: RowSelectionState;
  onSelectionChange?: (sel: RowSelectionState) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  filename?: string;
  /* How wide the table insists on being before the wrapper scrolls it
     sideways. `table-fixed` shares whatever is left over between the columns
     that declare no width, so a register with ten columns in a 900px box
     crushes every one of them equally — including the name column somebody
     actually reads. Registers with many columns should raise this. */
  minWidth?: string;
  /*
    Remembers this table's column widths per browser, under
    `sti-colwidths:<storageKey>`. Omit it and resizing still works, it just does
    not survive a reload — which is right for a table nobody has asked to keep.
  */
  storageKey?: string;
};

/* Narrow enough to be a deliberate act, wide enough to still grab. */
const MIN_COL_PX = 56;

function widthsKey(k: string) {
  return `sti-colwidths:${k}`;
}

function readWidths(k: string | undefined): Record<string, number> {
  if (!k) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(widthsKey(k)) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    /* Storage is editable by whoever holds the browser, so a value that is not
       a usable number is dropped rather than trusted into a style. */
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        ([, v]) => typeof v === "number" && Number.isFinite(v) && v >= MIN_COL_PX,
      ),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeWidths(k: string | undefined, w: Record<string, number>) {
  if (!k) return;
  try {
    localStorage.setItem(widthsKey(k), JSON.stringify(w));
  } catch {
    /* Quota or private mode. The resize still applies for this session. */
  }
}

export function DataTable<T>({
  columns,
  rows,
  mode = "client",
  rowId,
  filterPredicate,
  state,
  onStateChange,
  rowCount,
  filterSheetTitle,
  filterControls,
  filterActiveCount,
  onApplyFilters,
  onClearFilters,
  toolbarExtra,
  searchPlaceholder = "Search…",
  searchValue,
  onSearchChange,
  showToolbar = true,
  columnVisibilityInitial,
  enableSelection = false,
  selection,
  onSelectionChange,
  emptyTitle = "Nothing to show",
  emptyDescription,
  filename,
  minWidth = "720px",
  storageKey,
}: Props<T>) {
  const server = mode === "server";

  /*
    Column widths the reader has set by dragging.

    Empty until somebody drags, and that is the whole design: until then the
    columns keep the `meta.width` each screen declared, and the table behaves
    exactly as it did.

    Only the dragged column is stored. An earlier version captured EVERY
    column's pixel width on the first drag, on the theory that `table-fixed`
    would otherwise redistribute a fixed table width and steal the pixels from a
    neighbour. Measured both ways, column by column: the results are identical.
    A `table-fixed` table already grows to fit explicit column widths, so the
    wrapper scrolls and no neighbour moves. The extra bookkeeping bought
    nothing, so it is not here.
  */
  const [widths, setWidths] = useState<Record<string, number>>({});
  const dragRef = useRef<{ id: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    /* In an effect, not in the initialiser: reading storage during render would
       not match the server HTML. Same rule as `useNavPins`. */
    setWidths(readWidths(storageKey));
  }, [storageKey]);

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [visibility, setVisibility] = useState<VisibilityState>(columnVisibilityInitial ?? {});
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });

  /* Controlled search when the page owns the toolbar; internal otherwise. */
  const searchText =
    searchValue !== undefined ? searchValue : server ? (state?.search ?? "") : globalFilter;
  const changeSearch = (v: string) => {
    if (onSearchChange) onSearchChange(v);
    /* Client mode keeps the internal filter in step so the table filters even
       when the page drives the input; server mode pushes to the page's state
       which re-queries. */
    if (!server) setGlobalFilter(v);
    else table?.setGlobalFilter(v);
  };

  const scopedRows = useMemo(() => {
    if (server) return rows;
    return filterPredicate ? rows.filter(filterPredicate) : rows;
  }, [server, rows, filterPredicate]);

  const toggleOne = (id: string, on: boolean) => {
    if (!onSelectionChange) return;
    const next = { ...(selection ?? {}) };
    if (on) next[id] = true;
    else delete next[id];
    onSelectionChange(next);
  };

  /* Header checkbox — toggles every row that is currently filtered in, not
     just the page, since the whole point of selecting is a bulk action. */
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selectionColumn: ColumnDef<T> = useMemo(
    () => ({
      id: "__select",
      header: ({ table }) => {
        const filtered = table.getFilteredRowModel().rows;
        const allSelected = filtered.length > 0 && filtered.every((r) => r.getIsSelected());
        return (
          <input
            ref={selectAllRef}
            type="checkbox"
            role="checkbox"
            aria-label="Select all filtered tools"
            checked={allSelected}
            onChange={() => {
              const next = { ...(selection ?? {}) };
              if (allSelected) {
                for (const r of filtered) delete next[r.id];
              } else {
                for (const r of filtered) next[r.id] = true;
              }
              onSelectionChange?.(next);
            }}
            className="size-4 accent-primary"
          />
        );
      },
      cell: ({ row }) => (
        <input
          type="checkbox"
          role="checkbox"
          aria-label="Select this tool"
          checked={row.getIsSelected()}
          onChange={(e) => toggleOne(row.id, e.target.checked)}
          className="size-4 accent-primary"
        />
      ),
      enableSorting: false,
      enableHiding: false,
      /* `meta.width`, not TanStack's `size` — the renderer below reads meta.
         With size alone this column declared nothing, so it took an equal
         share of the table alongside the real columns. */
      meta: { width: "2.75rem" },
    }),
    [enableSelection, selection, onSelectionChange],
  );

  /* The selection column sits in front of the page's columns only when the
     parent asked for selection. */
  const activeColumns = enableSelection ? [selectionColumn, ...columns] : columns;

  /* Server mode: sorting/paging are controlled from the page's state, and the
     search text travels with it. */
  const tableState = server
    ? {
        sorting: state?.sortKey
          ? [{ id: state.sortKey, desc: state.sortDir === "desc" }]
          : [],
        pagination: {
          pageIndex: (state?.page ?? 1) - 1,
          pageSize: state?.pageSize ?? 25,
        },
        globalFilter: searchText,
      }
    : { sorting, pagination, globalFilter: searchText };

  const serverStateBase = (): DataTableServerState => ({
    page: state?.page ?? 1,
    pageSize: state?.pageSize ?? 25,
    sortKey: state?.sortKey,
    sortDir: state?.sortDir,
    search: state?.search,
  });

  const table = useReactTable({
    data: scopedRows,
    columns: activeColumns,
    state: {
      ...tableState,
      columnFilters,
      columnVisibility: visibility,
      ...(enableSelection ? { rowSelection: selection ?? {} } : {}),
    },
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setVisibility,
    getRowId: rowId,
    enableRowSelection: enableSelection ? true : undefined,
    onRowSelectionChange: enableSelection
      ? (updater) => {
          const next = typeof updater === "function" ? updater(selection ?? {}) : updater;
          onSelectionChange?.(next);
        }
      : undefined,
    manualPagination: server,
    manualSorting: server,
    manualFiltering: server,
    rowCount: server ? rowCount : undefined,
    pageCount: server ? Math.ceil((rowCount ?? 0) / tableState.pagination.pageSize) : undefined,
    onGlobalFilterChange: server
      ? (v) => onStateChange?.({ ...serverStateBase(), page: 1, search: String(v ?? "") })
      : setGlobalFilter,
    onSortingChange: server
      ? (updater) => {
          const next = typeof updater === "function" ? updater(tableState.sorting) : updater;
          const s = next[0];
          onStateChange?.({
            ...serverStateBase(),
            page: 1,
            sortKey: s?.id,
            sortDir: s?.desc ? "desc" : "asc",
          });
        }
      : setSorting,
    onPaginationChange: server
      ? (updater) => {
          const next = typeof updater === "function" ? updater(tableState.pagination) : updater;
          onStateChange?.({ ...serverStateBase(), page: next.pageIndex + 1, pageSize: next.pageSize });
        }
      : setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: server ? undefined : getSortedRowModel(),
    getFilteredRowModel: server ? undefined : getFilteredRowModel(),
    getPaginationRowModel: server ? undefined : getPaginationRowModel(),
  });

  /* Keep the header checkbox's indeterminate state in step with a partial
     selection (a ref-set property, not a React prop). */
  useEffect(() => {
    if (!selectAllRef.current) return;
    const filtered = table.getFilteredRowModel().rows;
    const all = filtered.length > 0 && filtered.every((r) => r.getIsSelected());
    const some = filtered.some((r) => r.getIsSelected());
    selectAllRef.current.indeterminate = some && !all;
  }, [table, selection]);

  const exportCsv = () => {
    const pageRows = table.getRowModel().rows.map((r) => r.original);
    if (!filename || !pageRows.length) return;
    const headers = table.getVisibleLeafColumns().map((c) => c.id);
    const data = pageRows.map((r) =>
      headers.map((h) => {
        const c = columns.find((col) => col.id === h) as
          | { accessorFn?: (row: T) => unknown }
          | undefined;
        const v = c?.accessorFn ? c.accessorFn(r) : "";
        return v === null || v === undefined ? "" : String(v);
      }),
    );
    downloadCsv(`${filename}-${new Date().toISOString().slice(0, 10)}`, [headers, ...data]);
  };

  const rowsOut = table.getRowModel().rows;
  const searching = Boolean(searchText);

  /*
    Start a drag.

    Captures EVERY column's current rendered width, not just the dragged one, so
    the table moves to explicit pixels in a single step. Measured off the live
    header cells rather than parsed from `meta.width`, because those are rem
    strings and the app has a font-scale preference — the rendered pixel width
    is the only honest starting point.

    Pointer capture, so a drag that leaves the header or the window still ends
    cleanly. A pointer-up outside the element is exactly how a resize gets stuck
    half-done.
  */
  const beginResize = (e: React.PointerEvent, columnId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th");
    if (!th) return;
    dragRef.current = {
      id: columnId,
      startX: e.clientX,
      /* The column's CURRENT rendered width, measured rather than parsed from
         `meta.width` — those are rem strings and the app has a font-scale
         preference, so the rendered pixel width is the only honest start. */
      startW: Math.round(th.getBoundingClientRect().width),
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const next = Math.max(MIN_COL_PX, Math.round(d.startW + (e.clientX - d.startX)));
    setWidths((w) => (w[d.id] === next ? w : { ...w, [d.id]: next }));
  };

  const endResize = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setWidths((w) => {
      writeWidths(storageKey, w);
      return w;
    });
  };

  /* Double-click a handle to give that column its declared width back. It undoes
     exactly what the gesture created, which a "reset columns" button somewhere
     else would not. */
  const resetColumn = (columnId: string) => {
    setWidths((w) => {
      const next = { ...w };
      delete next[columnId];
      writeWidths(storageKey, next);
      return next;
    });
  };

  const widthFor = (id: string, declared?: string) =>
    widths[id] !== undefined ? `${widths[id]}px` : declared;

  return (
    <div className="flex flex-col gap-3">
      {/* toolbar */}
      {showToolbar ? (
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(e) => changeSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
            aria-label="Search"
          />
        </div>
        {filterControls ? (
          <FilterSheet
            title={filterSheetTitle}
            activeCount={filterActiveCount}
            onApply={() => onApplyFilters?.()}
            onClear={onClearFilters}
          >
            {filterControls}
          </FilterSheet>
        ) : null}
        {toolbarExtra}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Choose columns">
              <Eye className="size-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllLeafColumns()
              .filter((c) => c.getCanHide())
              .map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={c.getIsVisible()}
                  onCheckedChange={(v) => c.toggleVisibility(!!v)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {c.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {filename ? (
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rowsOut.length}>
            <Download className="size-4" />
            Export CSV
          </Button>
        ) : null}
      </div>
      ) : null}

      {/* table — bounded scroll container so the header sticks (see globals).
          table-fixed makes columns honor their `width` and fill the container;
          columns without a width share the leftover, and long text wraps
          instead of blowing the layout out. */}
      <div className="sti-table-scroll overflow-x-auto rounded-md border">
        <Table className="w-full table-fixed" style={{ minWidth }}>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-muted/50 hover:bg-muted/50">
                {hg.headers.map((h) => {
                  const meta = (h.column.columnDef.meta as { numeric?: boolean; width?: string } | undefined) ?? {};
                  const numeric = meta.numeric;
                  const canSort = h.column.getCanSort();
                  const sorted = h.column.getIsSorted();
                  const Icon = !sorted ? ChevronsUpDown : sorted === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <TableHead
                      key={h.id}
                      className={cn("relative p-0", numeric && "text-right")}
                      style={{ width: widthFor(h.column.id, meta.width) }}
                    >
                      <button
                        type="button"
                        disabled={!canSort}
                        onClick={() => h.column.toggleSorting(sorted === "asc")}
                        className={cn(
                          "flex w-full items-center gap-1.5 px-3 py-2.5 text-xs font-medium uppercase tracking-wide",
                          numeric && "justify-end",
                          canSort ? "hover:text-foreground" : "cursor-default",
                        )}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {canSort ? (
                          <Icon className={cn("size-3 shrink-0", sorted ? "opacity-100" : "opacity-35")} />
                        ) : null}
                      </button>
                      {/*
                        The resize grip, on the column's trailing edge.

                        Absolutely positioned and only tinted on hover, so it
                        costs no layout space and the header does not change
                        height whether or not you are pointing at it — the rule
                        in `.claude/rules/web.md`. `touch-none` stops a drag on a
                        trackpad or tablet being read as a page scroll.

                        It sits ABOVE the sort button and stops propagation:
                        without that, every resize would also re-sort the table
                        on release, which is the single most annoying way to get
                        this wrong.
                      */}
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize column`}
                        onPointerDown={(e) => beginResize(e, h.column.id)}
                        onPointerMove={onResizeMove}
                        onPointerUp={endResize}
                        onPointerCancel={endResize}
                        onDoubleClick={() => resetColumn(h.column.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize touch-none select-none bg-transparent transition-colors hover:bg-primary/40"
                      />
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rowsOut.length ? (
              rowsOut.map((r) => (
                <TableRow key={rowId(r.original)}>
                  {r.getVisibleCells().map((c) => {
                    const meta = (c.column.columnDef.meta as { numeric?: boolean; width?: string } | undefined) ?? {};
                    return (
                      <TableCell
                        key={c.id}
                        /* Clipped, so a column whose content outgrows its
                           declared width truncates inside its own box instead
                           of painting over the cell beside it — which is how an
                           undersized actions column ended up sitting on top of
                           the status pill. Radix menus portal out, so the row
                           dropdowns are unaffected. */
                        className={cn("overflow-hidden", meta.numeric && "text-right tnum")}
                        style={{
                          width: widthFor(c.column.id, meta.width),
                          whiteSpace: meta.numeric ? "nowrap" : "normal",
                        }}
                      >
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length + (enableSelection ? 1 : 0)} className="h-40 text-center">
                  <EmptyState
                    title={searching ? "No rows match the search" : emptyTitle}
                    description={searching ? "Clear the search to see everything again." : emptyDescription}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination table={table} />
    </div>
  );
}
