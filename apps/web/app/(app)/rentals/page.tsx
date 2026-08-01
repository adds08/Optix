"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, Metric } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { ImportButton } from "@/components/import-dialog";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableServerState } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  Equipment Urban rents, as opposed to equipment Urban owns.

  The page opens on what is still out rather than on the full contract list,
  because the only urgent question here is "what are we still paying for that
  we are not using". A closed contract is history; an open one past its end
  date is an invoice arriving tomorrow.

  The "Still out" tab is the one table in the app that genuinely outgrows a
  page — vendor exports import thousands of lines — so it runs the DataTable
  in server mode: sort, page and search round-trip to rental.onRent, which
  computes overdue/days-to-off-rent server-side and returns one page.

  No cost anywhere on this page. The vendor export carries no rates, so any
  figure would be invented — days and quantities are what we actually know.
*/

const TABS = [
  { key: "on_rent", label: "Still out" },
  { key: "quoted", label: "Quoted" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;

type OnRentRow = {
  lineId: string;
  itemName: string;
  catClass: string | null;
  quantity: number | null;
  endDate: string | null;
  status: string;
  orderId: string;
  externalNumber: string;
  jobsiteLabel: string | null;
  projectName: string | null;
  vendorName: string | null;
  overdue: boolean;
  daysToOffRent: number | null;
};

export default function RentalsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("on_rent");
  const [q, setQ] = useState("");
  const [tableState, setTableState] = useState<DataTableServerState>({ page: 1, pageSize: 25 });

  const summary = trpc.rental.summary.useQuery();
  const onRent = trpc.rental.onRent.useQuery(
    {
      page: tableState.page,
      pageSize: tableState.pageSize,
      sortKey: tableState.sortKey,
      sortDir: tableState.sortDir,
      search: tableState.search,
    },
    { enabled: tab === "on_rent" },
  );
  const orders = trpc.rental.list.useQuery(
    { status: tab === "all" ? undefined : tab, search: q.trim() || undefined },
    { enabled: tab !== "on_rent" },
  );
  const unlinked = trpc.rental.unlinkedJobsites.useQuery();

  const utils = trpc.useUtils();
  const offRent = trpc.rental.offRent.useMutation({
    onSuccess: () => {
      utils.rental.onRent.invalidate();
      utils.rental.summary.invalidate();
      utils.rental.list.invalidate();
    },
  });

  const s = summary.data;
  const lines = onRent.data?.rows ?? [];
  const lineTotal = onRent.data?.total ?? 0;

  const onRentColumns: ColumnDef<OnRentRow>[] = [
    col<OnRentRow>({
      header: "Item",
      accessorFn: (r) => r.itemName,
      cell: (r) => (
        /* The quiet edge the register uses for high value, reused here for
           "this one is costing you". */
        <div className={cn("py-0.5", r.overdue && "shadow-[inset_2px_0_0_var(--crit)]")}>
          <span className="font-medium">{r.itemName}</span>
          {r.vendorName ? (
            <span className="block text-xs text-muted-foreground">{r.vendorName}</span>
          ) : null}
        </div>
      ),
    }),
    col<OnRentRow>({
      header: "Cat class",
      accessorFn: (r) => r.catClass ?? "",
      cell: (r) => (r.catClass ? <Tag>{r.catClass}</Tag> : <span className="text-muted-foreground">—</span>),
    }),
    col<OnRentRow>({
      header: "Qty",
      accessorFn: (r) => r.quantity ?? 0,
      numeric: true,
      cell: (r) => <span className="tnum">{r.quantity}</span>,
    }),
    col<OnRentRow>({
      header: "Jobsite",
      accessorFn: (r) => r.projectName ?? r.jobsiteLabel ?? "",
      cell: (r) =>
        r.projectName ?? (
          <span className="text-muted-foreground">{r.jobsiteLabel ?? "—"}</span>
        ),
    }),
    col<OnRentRow>({
      header: "Contract",
      accessorFn: (r) => r.externalNumber,
      cell: (r) => <span className="text-xs text-muted-foreground">{r.externalNumber}</span>,
    }),
    col<OnRentRow>({
      header: "Due",
      accessorFn: (r) => r.endDate ?? "",
      numeric: true,
      cell: (r) =>
        r.overdue ? (
          <span className="text-crit">
            {shortDate(r.endDate)}
            <span className="block text-xs">{Math.abs(r.daysToOffRent ?? 0)}d over</span>
          </span>
        ) : r.endDate ? (
          <span>
            {shortDate(r.endDate)}
            <span className="block text-xs text-muted-foreground">{r.daysToOffRent}d</span>
          </span>
        ) : (
          <span className="text-muted-foreground">open-ended</span>
        ),
    }),
    col<OnRentRow>({
      header: "",
      enableHiding: false,
      cell: (r) => (
        <Can perm="rental.manage">
          <Button
            size="sm"
            variant="outline"
            disabled={offRent.isPending}
            onClick={() => offRent.mutate({ lineId: r.lineId })}
          >
            Off rent
          </Button>
        </Can>
      ),
    }),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Equipment"
        title="Rented"
        description="Equipment on hire from vendors. Urban does not own these — every day one stays out is billable."
        actions={<ImportButton entity="rental" />}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Lines still out" value={s?.onRentLines ?? 0} loading={summary.isLoading} />
        <Metric
          label="Past return date"
          value={s?.overdueLines ?? 0}
          loading={summary.isLoading}
          tone={s?.overdueLines ? "crit" : "ok"}
          hint="still billing"
        />
        <Metric
          label="Due this week"
          value={s?.dueThisWeek ?? 0}
          loading={summary.isLoading}
          tone={s?.dueThisWeek ? "warn" : "default"}
        />
        <Metric label="Units out" value={s?.onRentUnits ?? 0} loading={summary.isLoading} />
      </div>

      {/* Until a vendor jobsite is matched to a project, none of this cost can
          be attributed to a job. Worth saying once, quietly, at the top. */}
      {unlinked.data?.length ? (
        <p className="rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-sm text-warn">
          {unlinked.data.length} vendor jobsite{unlinked.data.length === 1 ? "" : "s"} not yet
          matched to a project — rented cost cannot be charged anywhere until they are.
        </p>
      ) : null}

      <div className="flex overflow-hidden rounded-sm border self-start" role="group" aria-label="Filter">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={cn(
              "px-2.5 py-1.5 text-xs transition-colors",
              tab === t.key
                ? "bg-muted font-medium text-foreground"
                : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "on_rent" ? (
        onRent.isLoading ? (
          <TableSkeleton cols={6} />
        ) : onRent.isError ? (
          <ErrorNote message="Rented equipment could not be loaded." />
        ) : (
          <DataTable<OnRentRow>
            mode="server"
            columns={onRentColumns}
            rows={lines}
            rowCount={lineTotal}
            rowId={(r) => r.lineId}
            state={tableState}
            onStateChange={setTableState}
            searchPlaceholder="Search item, vendor, jobsite or contract…"
            emptyTitle="Nothing on rent"
            emptyDescription="Import a vendor export to see what is still out."
          />
        )
      ) : orders.isLoading ? (
        <TableSkeleton cols={6} />
      ) : orders.isError ? (
        <ErrorNote message="Rental orders could not be loaded." />
      ) : !orders.data?.length ? (
        <EmptyState icon={Truck} title="Nothing here" description="No orders in this state." />
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {["Contract", "Vendor", "Jobsite", "Ordered by", "Dates", "Lines", "Status"].map((h, i) => (
                  <th key={h} className={cn("label-xs px-4 py-2.5 text-left", i === 5 && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.data.map((o) => (
                <tr key={o.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2.5"><Tag>{o.externalNumber}</Tag></td>
                  <td className="px-4 py-2.5">{o.vendorName}</td>
                  <td className="px-4 py-2.5">
                    {o.projectName ?? (
                      <span className="text-muted-foreground">{o.jobsiteLabel ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{o.orderedByLabel ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {shortDate(o.startDate)} → {shortDate(o.endDate)}
                  </td>
                  <td className="px-4 py-2.5 text-right tnum">
                    {o.lineCount}
                    {o.overdueCount ? (
                      <span className="ml-1.5 text-xs text-crit">{o.overdueCount} over</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5"><StatusPill status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
