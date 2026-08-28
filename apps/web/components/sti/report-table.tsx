"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import { EmptyState, TableWrap } from "./page";

export type Col<T> = {
  key: keyof T & string;
  header: string;
  /* Right-align and tabular-number anything countable. */
  numeric?: boolean;
  /* Render override — status pills, tags, links. */
  cell?: (row: T) => React.ReactNode;
  /* Value used for sorting, searching and CSV when the cell is custom. */
  value?: (row: T) => string | number | null | undefined;
  width?: string;
};

function raw<T>(row: T, col: Col<T>): string | number | null | undefined {
  if (col.value) return col.value(row);
  const v = row[col.key] as unknown;
  if (v === null || v === undefined) return v as null | undefined;
  if (v instanceof Date) return v.toISOString();
  return v as string | number;
}

export function ReportTable<T extends Record<string, unknown>>({
  rows,
  cols,
  filename,
  searchable = true,
  emptyTitle = "Nothing to show",
  emptyDescription,
}: {
  rows: T[];
  cols: Col<T>[];
  filename: string;
  searchable?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      cols.some((c) => String(raw(r, c) ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, cols, q]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = cols.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = raw(a, col), bv = raw(b, col);
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (col.numeric) return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [filtered, sort, cols]);

  function toggleSort(key: string) {
    setSort((s) =>
      !s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null,
    );
  }

  function exportCsv() {
    downloadCsv(`${filename}-${new Date().toISOString().slice(0, 10)}`, [
      cols.map((c) => c.header),
      ...sorted.map((r) => cols.map((c) => raw(r, c))),
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      {/*
        A report that legitimately has nothing to show renders no toolbar at all.
        UI-68 and UI-69 were the same non-bug reported twice: on an empty report the
        row count read "0 rows", the filter box had nothing to filter and Export CSV
        was correctly `disabled` — but a greyed-out control sitting above the empty
        state reads as "the export is broken", not "there is nothing to export".
        Suppressing the whole toolbar leaves the empty state as the only thing on the
        page. Keyed on `rows`, not `sorted`: when a *filter* is what emptied the
        table the box must stay, or there is no way left to clear it.
      */}
      {rows.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {searchable ? (
            <div className="relative min-w-[220px] flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter rows…"
                className="pl-8"
                aria-label="Filter rows"
              />
            </div>
          ) : null}
          <span className="tnum text-sm text-muted-foreground">
            {sorted.length}
            {sorted.length !== rows.length ? ` of ${rows.length}` : ""} row{sorted.length === 1 ? "" : "s"}
          </span>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!sorted.length} className="ml-auto">
            <Download className="size-4" />
            Export CSV
          </Button>
        </div>
      ) : null}

      {!sorted.length ? (
        <EmptyState
          title={q ? "No rows match that filter" : emptyTitle}
          description={q ? "Clear the filter to see everything again." : emptyDescription}
        />
      ) : (
        <TableWrap>
          <div className="sti-table-scroll overflow-x-auto"><table className="sti-grid w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {cols.map((c) => {
                  const active = sort?.key === c.key;
                  const Icon = !active ? ChevronsUpDown : sort!.dir === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={c.key}
                      style={c.width ? { width: c.width } : undefined}
                      className={cn("p-0", c.numeric && "text-right")}
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          "label-xs flex w-full items-center gap-1.5 px-4 py-2.5 hover:text-foreground",
                          c.numeric && "justify-end",
                        )}
                      >
                        {c.header}
                        <Icon className={cn("size-3 shrink-0", active ? "opacity-100" : "opacity-35")} />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
                  {cols.map((c) => (
                    <td
                      key={c.key}
                      className={cn("px-4 py-2.5 align-middle", c.numeric && "text-right tnum")}
                    >
                      {c.cell ? c.cell(r) : ((raw(r, c) ?? "—") as React.ReactNode)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table></div>
        </TableWrap>
      )}
    </div>
  );
}
