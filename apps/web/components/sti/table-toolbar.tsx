"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/*
  The one toolbar for the data-heavy screens: the search on the left, the page's
  buttons to its right, and — by default — the card strip they sit on.

  WHY THE CARD LIVES HERE NOW. It used to be the consumer's job, on the reasoning
  that a page with its own card would end up with a card around a card. That was
  true, but it left the strip itself to be re-typed at every call site, and by
  2026-09-15 it had been: `flex flex-wrap items-center gap-2 rounded-md border
  bg-card p-2` appeared verbatim in three files, a `flex-col` variant in a fourth,
  and two screens drew no strip at all. Same control strip, four afternoons.
  The card therefore belongs to the component that is always there, and a page
  that genuinely owns its own container passes `card={false}` — one explicit
  decision instead of a repeated string.

  WHY `search` EXISTS. Not every search is this one: the org chart's local search
  carries a match counter and Enter-to-cycle, and the register's is shared with a
  non-table view. Those pages still want the strip, the position and the width
  rules, so they pass their own control through `search` and inherit everything
  else.

  The search is `flex-1` and uncapped, and the buttons sit in a right-aligned
  (`ml-auto`) group, so the search field is the same width and the buttons land in
  the same place on every page — a "Filters / Columns / Export" trio and an
  "Import / New / Saved" cluster both end flush right.
*/
export function TableToolbar({
  searchValue,
  onSearchChange,
  placeholder = "Search…",
  ariaLabel = "Search",
  search,
  card = true,
  children,
  className,
}: {
  /* Ignored when `search` is supplied — a custom control owns its own state. */
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  search?: React.ReactNode;
  card?: boolean;
  /* The page's buttons — filter sheet, sort, columns, export, layout/view
     toggles, import/new/saved. They flow into the right-aligned group and wrap
     under the search on a narrow row. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        card && "rounded-md border bg-card p-2",
        className,
      )}
    >
      {search !== undefined ? (
        search
      ) : (
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={searchValue ?? ""}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder={placeholder}
            className="pl-8"
            aria-label={ariaLabel}
          />
        </div>
      )}
      {/* Right-aligned to the END, not just after the search — the one rule
          every toolbar shares, so a lone "Columns" button and six buttons look
          like the same control strip, not two different layouts. */}
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
