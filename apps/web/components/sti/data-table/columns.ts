import type { ColumnDef } from "@tanstack/react-table";

/*
  Column-def helpers for the DataTable.

  Every column carries an `accessorFn` returning the value used for sorting
  and the global search, plus an optional `cell` renderer for pills, tags and
  links. A column with neither is display-only.
*/

export function col<T>(
  opts: {
    header: string;
    id?: string;
    accessorFn?: (row: T) => string | number | null | undefined;
    cell?: (row: T) => React.ReactNode;
    numeric?: boolean;
    sortable?: boolean;
    width?: string;
    enableHiding?: boolean;
    /* Sticks this column to the right edge, independent of the leading-prefix
       freeze count above. Meant for exactly one column per table — the
       actions menu — not a general "freeze from the right" feature; see the
       comment on `stickyRightProps` in data-table.tsx. */
    stickyRight?: boolean;
  },
): ColumnDef<T> {
  const id = opts.id ?? (opts.header || `col_${Math.random().toString(36).slice(2, 8)}`);
  return {
    id,
    header: opts.header,
    accessorFn: opts.accessorFn,
    cell: opts.cell ? (info) => opts.cell!(info.row.original as T) : undefined,
    enableSorting: opts.sortable ?? !!opts.accessorFn,
    enableHiding: opts.enableHiding ?? true,
    meta: {
      numeric: opts.numeric,
      width: opts.width,
      stickyRight: opts.stickyRight,
    } as never,
  };
}
