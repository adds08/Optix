"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/*
  The one toolbar ROW for the data-heavy screens: the global search left, every
  page button to its RIGHT or end. It deliberately does NOT draw its own card —
  the consumer owns the card (`DataTable` wraps it in the register card, the
  jobsites board already has one). Before this split the toolbar drew its own
  box, so a page that added its own card ended up with a card around a card
  around a card. One row, one owner of the card.

  The search is `flex-1` and uncapped, and the buttons sit in a right-aligned
  (`ml-auto`) group, so a search field is the same width and the buttons land
  at the same place on every page — a "Filters / Columns / Export" trio and a
  "Import / New / Saved" cluster both end flush right.

  The search is always controlled — the register so it can share the input with
  a non-table view, jobsites because its search also drives the cards above.
*/
export function TableToolbar({
  searchValue,
  onSearchChange,
  placeholder = "Search…",
  ariaLabel = "Search",
  children,
  className,
}: {
  searchValue: string;
  onSearchChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  /* The page's buttons — filter sheet, sort, columns, export, layout/view
     toggles, import/new/saved. They flow into the right-aligned group and wrap
     under the search on a narrow row. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="pl-8"
          aria-label={ariaLabel}
        />
      </div>
      {/* Right-aligned to the END, not just after the search — the one rule
          every toolbar shares, so a lone "Columns" button and six buttons look
          like the same control strip, not two different layouts. */}
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
