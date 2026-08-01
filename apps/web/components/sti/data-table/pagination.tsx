"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [10, 25, 50, 100];

/* The footer every DataTable shares: rows-per-page, page stepping, and an
   honest "x–y of z" count. Rows-per-page is a real user choice, not a buried
   constant — a desk person on a 100-row rental list pages differently from a
   warehouse person scanning 10 at a time. */
export function DataTablePagination<T>({ table }: { table: Table<T> }) {
  const page = table.getState().pagination;
  const total = table.getRowCount();
  const from = total === 0 ? 0 : page.pageIndex * page.pageSize + 1;
  const to = Math.min((page.pageIndex + 1) * page.pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-2 py-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="tnum">{from}–{to} of {total}</span>
        <select
          value={page.pageSize}
          onChange={(e) => table.setPageSize(Number(e.target.value))}
          aria-label="Rows per page"
          className="flex h-7 rounded-md border border-input bg-transparent px-1.5 text-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>{n} / page</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className={cn("tnum min-w-10 px-1 text-center text-sm text-muted-foreground")}>
          {total === 0 ? "0" : `${page.pageIndex + 1} / ${table.getPageCount()}`}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
