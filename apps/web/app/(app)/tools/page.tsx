"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, TableWrap } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { Input } from "@/components/ui/input";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

const FILTERS = ["all", "available", "assigned", "in_maintenance", "lost"] as const;

export default function ToolsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof FILTERS)[number]>("all");

  const list = trpc.asset.list.useQuery({
    search: q.trim() || undefined,
    status: status === "all" ? undefined : status,
  });

  const rows = list.data ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Equipment"
        title="Tool Register"
        description="Every serialized tool and bulk line the company owns. Open one to see its full custody chain."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by tag, model or serial…"
          className="max-w-sm"
          aria-label="Search tools"
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatus(f)}
              aria-pressed={status === f}
              className={cn(
                "rounded-sm border px-2.5 py-1 text-xs transition-colors",
                status === f
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {f === "all" ? "All" : humanize(f)}
              {status === "all" && counts[f] ? (
                <span className="ml-1.5 tnum opacity-70">{counts[f]}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {list.isLoading ? (
        <TableSkeleton cols={6} />
      ) : list.isError ? (
        <ErrorNote message="The tool register could not be loaded. Check that the API is running, then reload." />
      ) : !rows.length ? (
        <EmptyState
          icon={Boxes}
          title={q || status !== "all" ? "No tools match" : "No tools registered yet"}
          description={
            q || status !== "all"
              ? "Try a different search or clear the status filter."
              : "Import the existing fleet, or register the first tool to start the custody chain."
          }
        />
      ) : (
        <TableWrap>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {["Tag", "Model", "Status", "Held by", "On project", "Location", "Cost"].map((h, i) => (
                  <th
                    key={h}
                    className={cn("label-xs px-4 py-2.5 text-left", i === 6 && "text-right")}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/tools/${r.id}`} className="hover:underline">
                      <Tag>{r.tag}</Tag>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/tools/${r.id}`} className="font-medium hover:underline">
                      {r.modelName}
                    </Link>
                    {r.categoryName ? (
                      <span className="block text-xs text-muted-foreground">{r.categoryName}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
                  <td className="px-4 py-2.5">
                    {r.custodianName ?? <span className="text-muted-foreground">In warehouse</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.currentProjectName ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.locationName ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tnum">{money(r.acquisitionCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}
