"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { trpc } from "@/lib/trpc";
import { DataTable, type DataTableServerState } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { Tag } from "@/components/sti/status";
import { MovementsWidget } from "@/components/dashboard-widgets";
import { dateTime } from "@/lib/format";

/*
  The audit trail — everything that happened, in ledger order (docs/20, C1).

  This is the deep end of the single source of truth: the dashboard's movement
  strip is the same `transaction` rows, and this page is where the trail gets
  searched, filtered and paged. The page itself is registered under Reports so
  the nav has one "Activity/Logs" home instead of two.
*/

type AuditRow = {
  id: number;
  eventType: string;
  occurredAt: Date;
  note: string | null;
  tag: string | null;
  model: string;
  actorName: string | null;
};

/* A static route — no params to read. The old version read `slug` off an
   empty params object, decided the slug was wrong, and notFound()'d the page
   client-side while the server shell still returned 200. */
export default function AuditTrailPage() {

  const [state, setState] = useState<DataTableServerState>({ page: 1, pageSize: 25 });
  /* No bulk action reads this yet — turned on for consistency with the other
     registers. */
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  const query = trpc.report.auditTrail.useQuery({
    page: state.page,
    pageSize: state.pageSize,
    sortKey: state.sortKey,
    sortDir: state.sortDir,
    search: state.search,
  });

  const columns: ColumnDef<AuditRow>[] = [
    col<AuditRow>({
      header: "When",
      accessorFn: (r) => r.occurredAt.toISOString(),
      cell: (r) => <span className="tnum text-xs text-muted-foreground">{dateTime(r.occurredAt)}</span>,
    }),
    col<AuditRow>({
      header: "Event",
      accessorFn: (r) => r.eventType,
      cell: (r) => <span className="font-medium capitalize">{r.eventType.replace(/_/g, " ")}</span>,
    }),
    col<AuditRow>({
      header: "Tool",
      accessorFn: (r) => r.tag ?? r.model,
      cell: (r) => (
        <span className="flex items-center gap-2">
          <Tag>{r.tag}</Tag>
          <span className="truncate text-muted-foreground">{r.model || "—"}</span>
        </span>
      ),
    }),
    col<AuditRow>({
      header: "Note",
      accessorFn: (r) => r.note ?? "",
      cell: (r) => <span className="text-muted-foreground">{r.note ?? "—"}</span>,
    }),
    col<AuditRow>({
      header: "By",
      accessorFn: (r) => r.actorName ?? "",
      cell: (r) => <span className="text-muted-foreground">{r.actorName ?? "system"}</span>,
    }),
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/reports"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All reports
      </Link>

      <MovementsWidget />

      <DataTable<AuditRow>
        mode="server"
        columns={columns}
        rows={query.data?.rows ?? []}
        rowCount={query.data?.total ?? 0}
        rowId={(r) => String(r.id)}
        state={state}
        onStateChange={setState}
        searchPlaceholder="Search tag, model or note…"
        emptyTitle="No movements recorded yet"
        emptyDescription="The ledger is empty — every assignment, transfer and return will appear here."
        filename="audit-trail"
        enableSelection
        selection={selectedIds}
        onSelectionChange={setSelectedIds}
      />
    </div>
  );
}
