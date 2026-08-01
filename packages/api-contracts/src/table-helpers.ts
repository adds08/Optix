import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

/*
  Server-side pagination and sorting for the DataTable.

  Sort keys are whitelisted per router — `sortable` maps a public key to a SQL
  expression, and anything not in the map is rejected. A table that accepts
  arbitrary column names in `order by` is a table that lets the query string
  pick columns; the whitelist is the whole difference.
*/

export const pageParamsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  sortKey: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

export type PageParams = z.infer<typeof pageParamsSchema>;

export type Paginated<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type SortableMap = Record<string, SQL>;

export function sortSql(params: PageParams, sortable: SortableMap): SQL | undefined {
  if (!params.sortKey) return undefined;
  const col = sortable[params.sortKey];
  if (!col) return undefined;
  return params.sortDir === "desc" ? sql`${col} DESC` : sql`${col} ASC`;
}
