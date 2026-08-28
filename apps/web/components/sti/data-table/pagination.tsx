"use client";

import { ChevronLeft, ChevronRight, FunnelX } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [10, 25, 50, 100];

/* The strip every DataTable shares: rows-per-page, page stepping, and an
   honest "x–y of z" count. Rows-per-page is a real user choice, not a buried
   constant — a desk person on a 100-row list pages differently from a
   warehouse person scanning 10 at a time. A compact dropdown, not a search
   popover: there are only four options.

   It sits above the header, not below the last row — see the comment where
   DataTable places it. Hence `border-b` rather than `border-t`. */
export function DataTablePagination<T>({ table }: { table: Table<T> }) {
  const page = table.getState().pagination;
  const total = table.getRowCount();
  const pageCount = table.getPageCount();
  const from = total === 0 ? 0 : page.pageIndex * page.pageSize + 1;
  const to = Math.min((page.pageIndex + 1) * page.pageSize, total);
  /* Column filters are set inside a menu that closes behind them, so the strip
     is the only place that says any are on — and the only way out of them
     without hunting through the headers one at a time. */
  const columnFilters = table.getState().columnFilters;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="tnum">{from}–{to} of {total}</span>
        {columnFilters.length ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary"
            onClick={() => table.resetColumnFilters()}
          >
            <FunnelX className="size-3.5" aria-hidden />
            <span className="tnum">{columnFilters.length}</span> column filter
            {columnFilters.length === 1 ? "" : "s"} — clear
          </Button>
        ) : null}
        <span className="hidden items-center gap-1 sm:flex">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                <span className="tnum">{page.pageSize}</span>
                <ChevronRight className="size-3 rotate-90 opacity-60" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {PAGE_SIZES.map((n) => (
                <DropdownMenuItem key={n} onSelect={() => table.setPageSize(n)}>
                  <span className="tnum">{n}</span>
                  <span className="text-xs text-muted-foreground">/ page</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 px-0"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className={cn("tnum min-w-16 px-1 text-center text-sm text-muted-foreground")}>
          {total === 0 ? "0 of 0" : `${page.pageIndex + 1} of ${pageCount}`}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 px-0"
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
