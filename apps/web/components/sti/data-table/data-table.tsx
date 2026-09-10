"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Eye } from "lucide-react";
import {
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
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
  Row,
  RowPinningState,
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/sti/page";
import { TableToolbar } from "@/components/sti/table-toolbar";
import { DataTablePagination } from "./pagination";
import { FilterSheet } from "./filter-sheet";
import { ColumnMenu, isColumnFiltered } from "./column-menu";
import { RowTableProvider } from "./row-context";
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

/*
  The filter the column menu writes: "show rows whose value is one of these".

  It compares stringified values because that is what the menu's tick list is
  built from — the faceted counts arrive keyed by the raw accessor value, so a
  numeric column would otherwise offer `0` and match against `"0"` forever.
  An absent filter and an empty list both mean "everything", which is what lets
  unticking the last box read as clearing the filter rather than as hiding
  every row.
*/
function inValueSet<T>(row: Row<T>, columnId: string, value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  const v = row.getValue(columnId);
  return value.includes(v === null || v === undefined ? "" : String(v));
}

function widthsKey(k: string) {
  return `sti-colwidths:${k}`;
}

function frozenKey(k: string) {
  return `sti-frozen:${k}`;
}

/* Same contract as the widths above: storage belongs to whoever holds the
   browser, so a value that is not a small whole number is dropped rather than
   trusted into a `left` offset. */
function readFrozen(k: string | undefined): number {
  if (!k) return 0;
  const n = Number(localStorage.getItem(frozenKey(k)));
  return Number.isInteger(n) && n >= 0 && n <= 12 ? n : 0;
}

function writeFrozen(k: string | undefined, n: number) {
  if (!k) return;
  try {
    localStorage.setItem(frozenKey(k), String(n));
  } catch {
    /* Quota or private mode. The freeze still applies for this session. */
  }
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

  /*
    How many LEADING columns stay put while the rest scroll under them.

    A prefix, exactly as in a spreadsheet — "freeze up to this column" — rather
    than an arbitrary set. Pinning a middle column on its own raises "and where
    does it sit now", and every answer to that is worse than not offering it.
    Persisted with the widths, because a reader who froze the tag column wants it
    frozen tomorrow too.
  */
  const [frozen, setFrozen] = useState(0);
  /* The pixel offset each frozen column sticks at, measured off the live header
     rather than summed from `meta.width` — those are rem strings and the app has
     both a font scale and a drag-to-resize, so the rendered width is the only
     honest number. */
  const [lefts, setLefts] = useState<number[]>([]);
  const headRowRef = useRef<HTMLTableRowElement>(null);

  /* Rows lifted out of the sort and kept at the top. TanStack owns this one —
     `keepPinnedRows` is what makes a frozen row survive a page change, which is
     the whole reason to freeze one. Session-only: a pin is a working note about
     the tools in front of you, not a preference. */
  const [rowPinning, setRowPinning] = useState<RowPinningState>({ top: [], bottom: [] });

  useEffect(() => {
    /* In an effect, not in the initialiser: reading storage during render would
       not match the server HTML. Same rule as `useNavPins`. */
    setWidths(readWidths(storageKey));
    setFrozen(readFrozen(storageKey));
  }, [storageKey]);

  const freezeUpTo = (n: number) => {
    setFrozen(n);
    writeFrozen(storageKey, n);
  };

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
      rowPinning,
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
    enableRowPinning: true,
    onRowPinningChange: setRowPinning,
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
    /* Every column filters by "is one of these values" unless it says otherwise,
       because that is the only filter the column menu offers. */
    defaultColumn: { filterFn: inValueSet },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: server ? undefined : getSortedRowModel(),
    getFilteredRowModel: server ? undefined : getFilteredRowModel(),
    getPaginationRowModel: server ? undefined : getPaginationRowModel(),
    /* The distinct values behind the menu's tick list. Client mode only: in
       server mode the browser holds one page, and faceting that would present
       twenty-five values as the whole column. */
    getFacetedRowModel: server ? undefined : getFacetedRowModel(),
    getFacetedUniqueValues: server ? undefined : getFacetedUniqueValues(),
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

  /* Frozen rows first, then everything else. `getRowModel().rows` still holds
     both, so rendering it as well as these would print a pinned row twice. */
  const rowsOut = [...table.getTopRows(), ...table.getCenterRows()];
  const searching = Boolean(searchText);

  /*
    Measure where each frozen column starts.

    After render and off the real header cells, because the width of a column can
    come from a rem string, from a drag, or from `table-fixed` sharing out the
    remainder — and only one of those is knowable up front.
  */
  useEffect(() => {
    const row = headRowRef.current;
    if (!row || frozen <= 0) {
      setLefts((l) => (l.length ? [] : l));
      return;
    }
    const cells = Array.from(row.children) as HTMLElement[];
    const out: number[] = [];
    let x = 0;
    for (const cell of cells.slice(0, frozen)) {
      out.push(Math.round(x));
      x += cell.getBoundingClientRect().width;
    }
    setLefts((l) => (l.length === out.length && l.every((v, i) => v === out[i]) ? l : out));
  }, [frozen, widths, visibility, rowsOut.length]);

  /* A frozen cell needs a `left`, an opaque background and a z-index above the
     cells sliding under it — see `.sti-freeze` in globals.css. The edge class
     goes on the LAST frozen column, which is where the seam is. */
  const freezeProps = (index: number) => {
    if (index >= frozen || lefts[index] === undefined) return {};
    return {
      className: cn("sti-freeze sticky z-20", index === frozen - 1 && "sti-freeze-edge"),
      style: { left: `${lefts[index]}px` },
    };
  };

  /*
    The actions column, stuck to the right edge — not a general "freeze from
    the right" feature (the leading-prefix freeze above stays a prefix, for
    the same "and where does a middle column sit" reason it always was), just
    the one column every register already puts last. `right: 0` needs no
    measurement the way the leading freeze does, because there is nothing
    after it to make the offset ambiguous.
  */
  const stickyRightProps = (meta: { stickyRight?: boolean }) => {
    if (!meta.stickyRight) return {};
    return {
      className: cn("sti-freeze sticky z-20 sti-freeze-edge-right"),
      style: { right: 0 },
    };
  };

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
      /* DataTable owns the card here (the toolbar row itself is a bare
         TableToolbar — see its comment). The filters / columns / export and any
         page `toolbarExtra` all land inside one strip, right-aligned. */
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2">
      <TableToolbar searchValue={searchText} onSearchChange={changeSearch} placeholder={searchPlaceholder} className="w-full">
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
            <Button variant="outline" aria-label="Choose columns">
              <Eye className="size-3.5" />
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
          <Button variant="outline" onClick={exportCsv} disabled={!rowsOut.length}>
            <Download className="size-3.5" />
            Export CSV
          </Button>
        ) : null}
      </TableToolbar>
      </div>
      ) : null}

      {/* One bordered box: the pager strip, then the table under it.

          The pager sits ABOVE the header rather than beneath the last row.
          That is where Urban's timesheet has always put it, so it is where
          people here look for it, and it has a second virtue nobody asked for:
          the paging controls stay in the same place whether the page holds ten
          rows or a hundred, instead of walking down the screen.

          The strip is a sibling of the scrolling element rather than inside it,
          so the columns scroll sideways underneath it and the pager stays put.

          table-fixed makes columns honor their `width` and fill the container;
          columns without a width share the leftover, and long text wraps
          instead of blowing the layout out.

          `overflow-clip`, not `overflow-hidden`, on this wrapper — same
          reasoning as `app-shell.tsx`'s outer wrapper: `hidden` makes an
          element a scroll container even though nothing here scrolls it,
          which would hijack the pager's `sticky` below into sticking to
          THIS box instead of the page. `clip` rounds the same corners
          without that side effect.

          The pager sticks to the top of the browser window as the page
          scrolls (asked for directly); the column header does NOT, despite
          being asked for too — `.sti-table-scroll` just below is already a
          scroll container on both axes (`overflow-x: auto` forces the Y
          axis to compute the same way; see the comment on that class), so a
          sticky header placed inside it binds to that box's own vertical
          viewport — which never itself scrolls, rows being bounded by
          pagination rather than a nested scrollbox — and would sit inertly
          in place instead of following the window. Making the header do it
          too needs the header split into its own row outside the
          horizontal-scroll box with its scroll position synced to the
          body's, the way a real spreadsheet component does it — real work,
          tracked separately rather than guessed at without a browser to
          check it in. */}
      <div className="overflow-clip rounded-md border bg-card">
        {/* The toolbar is carded above; `bg-card` here makes the table itself
            the same white card, so a register reads as one surface instead of
            controls floating over a bare table. */}
        <div className="sticky top-0 z-30">
          <DataTablePagination table={table} />
        </div>
        <Table className="w-full table-fixed" style={{ minWidth }}>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow ref={headRowRef} key={hg.id} className="bg-muted/50 hover:bg-muted/50">
                {hg.headers.map((h, i) => {
                  const meta = (h.column.columnDef.meta as { numeric?: boolean; width?: string; stickyRight?: boolean } | undefined) ?? {};
                  const numeric = meta.numeric;
                  /* The menu belongs to columns that hold a value. The checkbox
                     and actions columns have no `accessorFn`, so there is
                     nothing to sort by and nothing to list. */
                  const hasValue = Boolean(h.column.accessorFn);
                  const frz = freezeProps(i);
                  const stickyR = stickyRightProps(meta);
                  return (
                    <TableHead
                      key={h.id}
                      className={cn(
                        "relative p-0",
                        numeric && "text-right",
                        frz.className,
                        stickyR.className,
                        /* A filtered column is marked in the header itself, not
                           only inside the menu that set it — otherwise a short
                           list looks like a short table. */
                        isColumnFiltered(h.column) && "bg-primary/10",
                      )}
                      style={{ width: widthFor(h.column.id, meta.width), ...frz.style, ...stickyR.style }}
                    >
                      <div className="flex w-full items-center">
                      {/* A plain label, not a control. Sorting lives in the
                          column menu below (caret) — the header used to also
                          toggle sort on click, which was two controls doing
                          the same job; the menu is the one that survived,
                          because it is also where the sort direction actually
                          shows once opened. */}
                      <span
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-1.5 py-2 pl-3 text-xs font-medium uppercase tracking-wide",
                          /* The menu button supplies the trailing gap when it is
                             there; without it the cell needs its own. */
                          hasValue ? "pr-1" : "pr-3",
                          numeric && "justify-end",
                          /* The select-all checkbox, matching how each row's own
                             checkbox is now centred in its cell — see the body
                             cell rendering below. */
                          h.column.id === "__select" && "justify-center",
                        )}
                      >
                        <span className="truncate">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                        </span>
                      </span>
                      {hasValue ? (
                        <ColumnMenu
                          column={h.column}
                          label={String(h.column.columnDef.header ?? h.column.id)}
                          faceted={!server}
                          freeze={{ position: i + 1, frozen, setFrozen: freezeUpTo }}
                        />
                      ) : null}
                      </div>
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
                <TableRow
                  key={rowId(r.original)}
                  /* A frozen row is lifted out of the sort, so it has to say so
                     — otherwise it reads as a sorting bug. */
                  className={cn(r.getIsPinned() && "sti-freeze-row bg-primary/5")}
                >
                  {/* Freezing a row is a property of the TABLE; `RowActions` is
                      built by the page. This is how the two meet without every
                      register threading a row id through. See `row-context.tsx`. */}
                  <RowTableProvider
                    value={{
                      pinned: !!r.getIsPinned(),
                      togglePinned: () => r.pin(r.getIsPinned() ? false : "top"),
                    }}
                  >
                  {r.getVisibleCells().map((c, i) => {
                    const meta = (c.column.columnDef.meta as { numeric?: boolean; width?: string; stickyRight?: boolean } | undefined) ?? {};
                    const frz = freezeProps(i);
                    const stickyR = stickyRightProps(meta);
                    /* The checkbox and the row's action-menu trigger are both
                       small fixed-size controls in an otherwise-empty cell —
                       left them at the cell's default alignment and they sit
                       flush against the left padding instead of centred under
                       their header. Every other column stays untouched. */
                    const centerContent = c.column.id === "__select" || meta.stickyRight;
                    return (
                      <TableCell
                        key={c.id}
                        /* Single-line + ellipsis, not wrap and not a silent
                           clip. A text column that wrapped its "FM-001 -
                           Alejandro Capuchino" over two lines made every row
                           tall, and `overflow-hidden` without ellipsis cut the
                           same name mid-word ("Whitfi"). `truncate` keeps the
                           row one line and shows a "…" at the column edge, so
                           a wide name is readable up to the boundary and never
                           painted over its neighbour. */
                        className={cn("truncate", meta.numeric && "text-right tnum", frz.className, stickyR.className)}
                        style={{
                          width: widthFor(c.column.id, meta.width),
                          ...frz.style,
                          ...stickyR.style,
                        }}
                      >
                        {centerContent ? (
                          <div className="flex items-center justify-center">
                            {flexRender(c.column.columnDef.cell, c.getContext())}
                          </div>
                        ) : (
                          flexRender(c.column.columnDef.cell, c.getContext())
                        )}
                      </TableCell>
                    );
                  })}
                  </RowTableProvider>
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
    </div>
  );
}
