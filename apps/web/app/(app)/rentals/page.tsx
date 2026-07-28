"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, TableWrap, Metric } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { ImportButton } from "@/components/import-dialog";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  Equipment Urban rents, as opposed to equipment Urban owns.

  The page opens on what is still out rather than on the full contract list,
  because the only urgent question here is "what are we still paying for that
  we are not using". A closed contract is history; an open one past its end
  date is an invoice arriving tomorrow.

  No cost anywhere on this page. The vendor export carries no rates, so any
  figure would be invented — days and quantities are what we actually know.
*/

const TABS = [
  { key: "on_rent", label: "Still out" },
  { key: "quoted", label: "Quoted" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;

export default function RentalsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("on_rent");
  const [q, setQ] = useState("");

  const summary = trpc.rental.summary.useQuery();
  const onRent = trpc.rental.onRent.useQuery(undefined, { enabled: tab === "on_rent" });
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
  const lines = (onRent.data ?? []).filter((l) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      l.itemName.toLowerCase().includes(needle) ||
      (l.catClass ?? "").toLowerCase().includes(needle) ||
      (l.jobsiteLabel ?? "").toLowerCase().includes(needle) ||
      l.externalNumber.toLowerCase().includes(needle)
    );
  });

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
          matched to a project — rented cost cannot be charged to a job until they are.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-sm border" role="group" aria-label="Filter">
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
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search item, cat class, jobsite or contract…"
          className="max-w-sm"
          aria-label="Search rentals"
        />
      </div>

      {tab === "on_rent" ? (
        onRent.isLoading ? (
          <TableSkeleton cols={6} />
        ) : onRent.isError ? (
          <ErrorNote message="Rented equipment could not be loaded." />
        ) : !lines.length ? (
          <EmptyState
            icon={Truck}
            title={q ? "Nothing matches" : "Nothing on rent"}
            description={
              q
                ? "Try a different search."
                : "Import a vendor export to see what is still out."
            }
          />
        ) : (
          <TableWrap>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {["Item", "Cat class", "Qty", "Jobsite", "Contract", "Due", ""].map((h, i) => (
                    <th
                      key={h || "actions"}
                      className={cn("label-xs px-4 py-2.5 text-left", i >= 5 && "text-right")}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.lineId} className="border-b last:border-0 hover:bg-muted/40">
                    {/* The quiet edge the register uses for high value, reused
                        here for "this one is costing you". */}
                    <td className={cn("px-4 py-2.5", l.overdue && "shadow-[inset_2px_0_0_var(--crit)]")}>
                      <span className="font-medium">{l.itemName}</span>
                      {l.vendorName ? (
                        <span className="block text-xs text-muted-foreground">{l.vendorName}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">{l.catClass ? <Tag>{l.catClass}</Tag> : "—"}</td>
                    <td className="px-4 py-2.5 tnum">{l.quantity}</td>
                    <td className="px-4 py-2.5">
                      {l.projectName ?? (
                        <span className="text-muted-foreground">{l.jobsiteLabel ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{l.externalNumber}</td>
                    <td className="px-4 py-2.5 text-right">
                      {l.overdue ? (
                        <span className="text-crit">
                          {shortDate(l.endDate)}
                          <span className="block text-xs">
                            {Math.abs(l.daysToOffRent ?? 0)}d over
                          </span>
                        </span>
                      ) : l.endDate ? (
                        <span>
                          {shortDate(l.endDate)}
                          <span className="block text-xs text-muted-foreground">
                            {l.daysToOffRent}d
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">open-ended</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Can perm="rental.manage">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={offRent.isPending}
                          onClick={() => offRent.mutate({ lineId: l.lineId })}
                        >
                          Off rent
                        </Button>
                      </Can>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )
      ) : orders.isLoading ? (
        <TableSkeleton cols={6} />
      ) : orders.isError ? (
        <ErrorNote message="Rental orders could not be loaded." />
      ) : !orders.data?.length ? (
        <EmptyState icon={Truck} title="Nothing here" description="No orders in this state." />
      ) : (
        <TableWrap>
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
        </TableWrap>
      )}
    </div>
  );
}
