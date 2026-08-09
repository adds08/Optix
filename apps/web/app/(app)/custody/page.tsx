"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Wrench } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { trpc } from "@/lib/trpc";
import { TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { useJobScope } from "@/components/job-scope";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { shortDate, daysFrom, relative, idName } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  Assignments and transfers on one screen. Splitting them across two pages
  makes people navigate to answer a single question — "who has what, and
  what is moving" is one thought, not two.
*/
export default function CustodyPage() {
  const [tab, setTab] = useState<"held" | "moving">("held");

  const assignments = trpc.assignment.list.useQuery();
  const transfers = trpc.transfer.list.useQuery();

  /* System-wide project scope: a scoped user sees only custody on their jobs. */
  const { projectIds: scopeProjects } = useJobScope();
  const scoped = (a: { projectId?: string | null }) =>
    !scopeProjects || (a.projectId ? scopeProjects.has(a.projectId) : false);

  const active = (assignments.data ?? []).filter(
    (a) => a.status === "active" && scoped(a),
  );
  const inFlight = (transfers.data ?? []).filter((t) => t.status !== "completed" && t.status !== "cancelled");

  type HeldRow = (typeof active)[number];
  type TransferRow = NonNullable<(typeof transfers.data)>[number];

  const HELD_COLUMNS: ColumnDef<HeldRow>[] = useMemo(
    () => [
      col<HeldRow>({ header: "Tag", accessorFn: (a) => a.tag ?? "", width: "6rem", cell: (a) => <Link href={`/tools/${a.assetId}`}><Tag>{a.tag}</Tag></Link> }),
      col<HeldRow>({ header: "Model", accessorFn: (a) => a.modelName ?? "", cell: (a) => <span className="font-medium">{a.modelName}</span> }),
      col<HeldRow>({ header: "Held by", accessorFn: (a) => a.custodianName ?? "", cell: (a) => a.custodianName ?? "—" }),
      col<HeldRow>({ header: "Project", accessorFn: (a) => a.projectName ?? "", cell: (a) => (a.projectName ? idName(a.projectExternalId, a.projectName) : "—") }),
      col<HeldRow>({ header: "Rig", accessorFn: (a) => a.locationName ?? "", cell: (a) => a.locationName ?? "—" }),
      col<HeldRow>({
        header: "Since",
        accessorFn: (a) => a.startDate ?? "",
        width: "8rem",
        cell: (a) => (a.startDate ? <span className="text-muted-foreground">{shortDate(a.startDate)}</span> : "—"),
      }),
      col<HeldRow>({
        header: "Status",
        accessorFn: (a) => a.status,
        width: "8rem",
        cell: (a) => <StatusPill status={a.status} />,
      }),
    ],
    [],
  );

  const MOVING_COLUMNS: ColumnDef<TransferRow>[] = useMemo(
    () => [
      col<TransferRow>({ header: "Tag", accessorFn: (t) => t.tag ?? "", width: "6rem", cell: (t) => <Link href={`/tools/${t.assetId}`}><Tag>{t.tag}</Tag></Link> }),
      col<TransferRow>({ header: "Model", accessorFn: (t) => t.modelName ?? "", cell: (t) => <span className="font-medium">{t.modelName}</span> }),
      col<TransferRow>({ header: "Reason", accessorFn: (t) => String(t.reason ?? "").replace(/_/g, " "), cell: (t) => <span className="capitalize">{String(t.reason).replace(/_/g, " ")}</span> }),
      col<TransferRow>({ header: "Status", accessorFn: (t) => t.status, width: "9rem", cell: (t) => <StatusPill status={t.status} /> }),
      col<TransferRow>({ header: "Requested", accessorFn: (t) => (t.createdAt ? t.createdAt.toISOString() : ""), width: "8rem", cell: (t) => <span className="text-muted-foreground">{shortDate(t.createdAt)}</span> }),
      col<TransferRow>({ header: "Completed", accessorFn: (t) => (t.completedAt ? t.completedAt.toISOString() : ""), width: "8rem", cell: (t) => <span className="text-muted-foreground">{t.completedAt ? shortDate(t.completedAt) : "—"}</span> }),
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Counts ride on the tabs, so there is no card row here repeating them
          back. In-motion gets one line of text because it is not a tab of its
          own. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex gap-1" role="tablist">
          {([["held", "Held", active.length], ["moving", "Moving", transfers.data?.length ?? 0]] as const).map(
            ([k, label, n]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  "rounded-sm border px-3 py-1.5 text-sm transition-colors",
                  tab === k
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {label} <span className="tnum opacity-75">{n}</span>
              </button>
            ),
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="tnum">{inFlight.length}</span> in motion
        </p>
      </div>

      {tab === "held" ? (
        assignments.isLoading ? (
          <TableSkeleton cols={6} />
        ) : assignments.isError ? (
          <ErrorNote message="Assignments could not be loaded." />
        ) : !active.length ? (
          <EmptyState icon={Wrench} title="No tool is currently out" description="Everything is in the yard." />
        ) : (
          <DataTable<HeldRow>
            mode="client"
            columns={HELD_COLUMNS}
            rows={active}
            rowId={(a) => a.id}
            searchPlaceholder="Search held tools…"
          />
        )
      ) : transfers.isLoading ? (
        <TableSkeleton cols={5} />
      ) : transfers.isError ? (
        <ErrorNote message="Transfers could not be loaded." />
      ) : !transfers.data?.length ? (
        <EmptyState icon={ArrowLeftRight} title="No transfers recorded" />
      ) : (
        <DataTable<TransferRow>
          mode="client"
          columns={MOVING_COLUMNS}
          rows={transfers.data}
          rowId={(t) => t.id}
          searchPlaceholder="Search transfers…"
        />
      )}
    </div>
  );
}
