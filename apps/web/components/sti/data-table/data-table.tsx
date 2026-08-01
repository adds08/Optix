"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Download,
  Eye,
  Search,
} from "lucide-react";
import {
  ColumnDef,
  ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
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
  emptyTitle?: string;
  emptyDescription?: string;
  filename?: string;
};

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
  emptyTitle = "Nothing to show",
  emptyDescription,
  filename,
}: Props<T>) {
  const server = mode === "server";

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
    columns,
    state: { ...tableState, columnFilters, columnVisibility: visibility },
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setVisibility,
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

      {/* table */}
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-muted/50 hover:bg-muted/50">
                {hg.headers.map((h) => {
                  const numeric = (h.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric;
                  const canSort = h.column.getCanSort();
                  const sorted = h.column.getIsSorted();
                  const Icon = !sorted ? ChevronsUpDown : sorted === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <TableHead key={h.id} className={cn("p-0", numeric && "text-right")}>
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
                    const numeric = (c.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric;
                    return (
                      <TableCell key={c.id} className={cn(numeric && "text-right tnum")}>
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-40 text-center">
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
