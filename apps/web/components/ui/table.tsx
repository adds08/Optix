"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/* Set by `<Table stickyHeader>`; read by `TableHeader`. A context rather than a
   prop because `<thead>` is usually written by the caller, several levels below
   the `<Table>` that decides the scroll behaviour. */
const TableStickyContext = React.createContext(false)

function Table({
  className,
  stickyHeader,
  ...props
}: React.ComponentProps<"table"> & {
  /* Opt in to a header that stays put while the page scrolls.
     See the container class below for why this costs horizontal scrolling. */
  stickyHeader?: boolean
}) {
  return (
    <TableStickyContext.Provider value={!!stickyHeader}>
      {/* THIS is the element that actually scrolls a wide table sideways, and it
          took until 2026-08-28 for anyone to notice — DataTable wrapped the
          primitive in a second `overflow-x-auto` box and styled THAT one, so the
          horizontal scrollbar people were looking for was being drawn by an
          unstyled container underneath it. `sti-table-scroll` carries the visible
          scrollbar and the overscroll containment; see globals.css.

          WHY `stickyHeader` AND THIS SCROLLER ARE MUTUALLY EXCLUSIVE.
          `position: sticky` binds to the nearest ancestor that is a scroll
          container, and `overflow-x: auto` makes this box one on BOTH axes (the
          spec computes the other axis's `visible` to `auto`). A sticky `<thead>`
          inside it therefore binds HERE — and this box never scrolls vertically,
          because its height is its content's, so the header sits inert instead of
          following the page. That is why every `sticky top-0` header written
          before today did nothing at all. Opting in drops the horizontal
          scroller, so the header binds to the page's own scroll region. A table
          that needs BOTH has to have its header split into a second table with
          the horizontal scroll synced — that is what DataTable does. */}
      <div
        data-slot="table-container"
        className={cn(
          "relative w-full",
          stickyHeader ? "overflow-x-clip" : "sti-table-scroll overflow-x-auto",
        )}
      >
        {/* `sti-grid` rules every cell on all four sides — see globals.css. It is
            on the primitive rather than on each caller so a new table is ruled
            the day it is written, without anyone remembering to ask for it. */}
        <table
          data-slot="table"
          className={cn("sti-grid w-full caption-bottom text-sm", className)}
          {...props}
        />
      </div>
    </TableStickyContext.Provider>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  const sticky = React.useContext(TableStickyContext)
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "[&_tr]:border-b",
        /* z-20 clears the frozen cells in the body (z-10) and stays under the
           app's top bar. No background is set here on purpose: `.sti-grid
           thead th` already paints `--muted`, opaquely, for exactly this
           reason — a translucent header would let rows scroll through it. */
        sticky && "sticky top-0 z-20",
        className,
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        /* h-8, not h-10: a 40px strip around an 11px uppercase label was the
           register's tallest line, taller than its own rows and the toolbar
           buttons beside it. 32px sits level with the dense single-line rows
           and just under the 34px toolbar controls. */
        "h-8 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        /* py-1.5, not p-2: 16px of vertical breathing made register rows read
           tall next to a 34px toolbar; 12px keeps a row to one crisp line
           (~36px) with the hairline rules between rows. */
        "px-2 py-1.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
