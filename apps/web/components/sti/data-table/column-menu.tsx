"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, EyeOff, Search, Snowflake, X } from "lucide-react";
import type { Column } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/*
  The per-column menu, on the caret in the header cell.

  Modelled on the one everybody already knows from Excel and from every grid
  that copied it: sort from here, and tick the values you want to see.

  Clicking the header itself used to ALSO sort, same as Excel — removed
  2026-08-30. Two controls doing the same job is not an affordance, it is a
  redundancy, and the header button's own icon was the only place sort
  direction showed at a glance. That glance now lives on this trigger
  instead: it tints the same way the filter dot already did, extended to
  cover "this column is sorted" as well as "this column is filtered".

  Two things it deliberately does NOT do:

  - It does not draft. A tick applies immediately, because in client mode
    filtering is a pass over an array already in memory. `FilterSheet` drafts
    and commits on Apply for the opposite reason: those filters travel to the
    server, so a keystroke there is a query.
  - It does not appear in server mode. The value list comes from the rows the
    browser is holding, and in server mode that is one page — a list of
    twenty-five values presented as "the values in this column" would be a lie.
    Sorting and hiding still work there; the list is what is suppressed.
*/

/* An empty cell is a real thing to filter on — "the tools with no project" is
   a question people ask — so it gets a row rather than being dropped. */
const BLANK = "";
const BLANK_LABEL = "(Blank)";

export function isColumnFiltered<T>(column: Column<T, unknown>) {
  const v = column.getFilterValue();
  return Array.isArray(v) && v.length > 0;
}

/*
  Freezing is a PREFIX, exactly as in a spreadsheet: "freeze up to this column"
  keeps columns one through this one, and no arbitrary subset. That is not a
  simplification of the idea — it is the idea. Pinning a middle column on its own
  raises "where does it go now", and the honest answers are all worse than not
  offering it.
*/
export type ColumnFreeze = {
  /* This column's position among the visible ones, counting from 1. */
  position: number;
  /* How many leading columns are frozen right now. */
  frozen: number;
  setFrozen: (n: number) => void;
};

export function ColumnMenu<T>({
  column,
  label,
  faceted,
  freeze,
}: {
  column: Column<T, unknown>;
  label: string;
  faceted: boolean;
  freeze?: ColumnFreeze;
}) {
  const [open, setOpen] = useState(false);
  const filtered = isColumnFiltered(column);
  /* Sort has no other visible home now that the header no longer doubles as
     the control — this is the one place left that says "this column is
     driving the current order" without opening the menu. */
  const active = filtered || Boolean(column.getIsSorted());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} column options`}
          aria-haspopup="menu"
          className={cn(
            /* Always rendered and always occupying its space, never revealed on
               hover: a control that appears under the pointer changes nothing
               about the layout but does change what the header looks like, and
               it cannot be found by somebody who does not already know it is
               there. Which is exactly how this got reported. */
            /* Tight on purpose. Every pixel here comes off the header label,
               and at `size-6` with a `mr-1.5` the CATEGORY column — 8rem, the
               width it has always been — started truncating its own heading. */
            "mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors",
            "hover:bg-background/80 hover:text-foreground",
            active ? "bg-primary/15 text-primary opacity-100" : "opacity-50 hover:opacity-100",
          )}
        >
          <ChevronDown className="size-3" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <MenuBody column={column} faceted={faceted} freeze={freeze} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/* Its own component so the faceted value list is only walked while the menu is
   actually open — Radix unmounts the content when it closes. */
function MenuBody<T>({
  column,
  faceted,
  freeze,
  onClose,
}: {
  column: Column<T, unknown>;
  faceted: boolean;
  freeze?: ColumnFreeze;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const sorted = column.getIsSorted();
  const selected = (column.getFilterValue() as string[] | undefined) ?? [];
  const selectedSet = new Set(selected);

  /* Faceted counts arrive keyed by the raw accessor value — numbers, dates,
     nulls. They are collapsed to the same strings the filter compares against,
     so 0 and "0" cannot show up as two rows that mean one thing. */
  const values = faceted
    ? [
        ...[...column.getFacetedUniqueValues()].reduce((acc, [v, n]) => {
          const key = v === null || v === undefined ? BLANK : String(v);
          acc.set(key, (acc.get(key) ?? 0) + n);
          return acc;
        }, new Map<string, number>()),
      ]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }))
    : [];

  /* No filter means everything is showing, so every box is ticked. Unticking
     the first one therefore has to start from "all of them" rather than from
     the empty selection — otherwise the click reads as "show only this", which
     is the opposite of what the box says. */
  const none = selected.length === 0;
  const shown = q.trim()
    ? values.filter((v) => (v.value || BLANK_LABEL).toLowerCase().includes(q.trim().toLowerCase()))
    : values;

  const commit = (next: string[]) => {
    column.setFilterValue(next.length === 0 || next.length === values.length ? undefined : next);
  };

  const toggle = (value: string) => {
    const base = none ? values.map((v) => v.value) : selected;
    commit(base.includes(value) ? base.filter((v) => v !== value) : [...base, value]);
  };

  return (
    <div className="flex flex-col text-sm">
      <div className="flex flex-col p-1">
        <MenuItem
          icon={ArrowUp}
          active={sorted === "asc"}
          onClick={() => {
            column.toggleSorting(false);
            onClose();
          }}
        >
          Sort ascending
        </MenuItem>
        <MenuItem
          icon={ArrowDown}
          active={sorted === "desc"}
          onClick={() => {
            column.toggleSorting(true);
            onClose();
          }}
        >
          Sort descending
        </MenuItem>
        {sorted ? (
          <MenuItem icon={X} onClick={() => column.clearSorting()}>
            Clear sort
          </MenuItem>
        ) : null}
        {column.getCanHide() ? (
          <MenuItem
            icon={EyeOff}
            onClick={() => {
              column.toggleVisibility(false);
              onClose();
            }}
          >
            Hide column
          </MenuItem>
        ) : null}
        {/* Offered on the column that would BECOME the boundary, and on the one
            that already is — those are the only two states worth a click. On any
            other column the item would either repeat the current setting or ask
            for a subset this does not do. */}
        {freeze && freeze.frozen !== freeze.position ? (
          <MenuItem
            icon={Snowflake}
            onClick={() => {
              freeze.setFrozen(freeze.position);
              onClose();
            }}
          >
            Freeze up to here
          </MenuItem>
        ) : null}
        {freeze && freeze.frozen > 0 ? (
          <MenuItem
            icon={Snowflake}
            active={freeze.frozen === freeze.position}
            onClick={() => {
              freeze.setFrozen(0);
              onClose();
            }}
          >
            Unfreeze columns
          </MenuItem>
        ) : null}
      </div>

      {faceted && values.length ? (
        <>
          <div className="border-t px-2 py-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search values…"
                aria-label="Search values"
                className="h-8 pl-7 text-sm"
              />
            </div>
          </div>
          <div className="sti-scroll max-h-56 px-1 pb-1">
            {shown.length ? (
              shown.map((v) => (
                <label
                  key={v.value}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    className="size-3.5 shrink-0 accent-primary"
                    checked={none || selectedSet.has(v.value)}
                    onChange={() => toggle(v.value)}
                  />
                  <span className={cn("min-w-0 flex-1 truncate", !v.value && "text-muted-foreground")}>
                    {v.value || BLANK_LABEL}
                  </span>
                  <span className="tnum shrink-0 text-xs text-muted-foreground">{v.count}</span>
                </label>
              ))
            ) : (
              <p className="px-2 py-3 text-xs text-muted-foreground">No value matches that.</p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={none}
              onClick={() => column.setFilterValue(undefined)}
            >
              Clear filter
            </Button>
            <Button size="sm" className="h-7 px-3 text-xs" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  active,
  onClick,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent",
        active && "font-medium text-primary",
      )}
    >
      <Icon className="size-3.5 shrink-0 opacity-70" />
      {children}
    </button>
  );
}
