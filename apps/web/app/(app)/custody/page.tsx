"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { TableSkeleton, ErrorNote, EmptyState, TableWrap, Metric } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { shortDate, daysFrom, relative } from "@/lib/format";
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

  const active = (assignments.data ?? []).filter((a) => a.status === "active" || a.status === "overdue");
  const overdue = active.filter((a) => a.expectedEnd && (daysFrom(a.expectedEnd) ?? -1) > 0);
  const inFlight = (transfers.data ?? []).filter((t) => t.status !== "completed" && t.status !== "cancelled");

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Tools out" value={active.length} loading={assignments.isLoading} hint="active assignments" />
        <Metric
          label="Overdue"
          value={overdue.length}
          loading={assignments.isLoading}
          tone={overdue.length ? "crit" : "ok"}
          hint="past expected return"
        />
        <Metric label="In motion" value={inFlight.length} loading={transfers.isLoading} hint="transfers not yet completed" />
      </div>

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

      {tab === "held" ? (
        assignments.isLoading ? (
          <TableSkeleton cols={6} />
        ) : assignments.isError ? (
          <ErrorNote message="Assignments could not be loaded." />
        ) : !active.length ? (
          <EmptyState icon={Wrench} title="No tool is currently out" description="Everything is in the yard." />
        ) : (
          <TableWrap>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {["Tag", "Model", "Held by", "Project", "Location", "Type", "Due", "Status"].map((h) => (
                    <th key={h} className="label-xs px-4 py-2.5 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map((a) => {
                  const late = a.expectedEnd ? (daysFrom(a.expectedEnd) ?? -1) > 0 : false;
                  return (
                    <tr key={a.id} className={cn("border-b last:border-0 hover:bg-muted/40", late && "bg-crit-bg/40")}>
                      <td className="px-4 py-2.5">
                        <Link href={`/tools/${a.assetId}`}><Tag>{a.tag}</Tag></Link>
                      </td>
                      <td className="px-4 py-2.5 font-medium">{a.modelName}</td>
                      <td className="px-4 py-2.5">{a.custodianName ?? "—"}</td>
                      <td className="px-4 py-2.5">{a.projectName ?? "—"}</td>
                      <td className="px-4 py-2.5">{a.locationName ?? "—"}</td>
                      <td className="px-4 py-2.5 capitalize">{a.type}</td>
                      <td className="px-4 py-2.5">
                        {a.expectedEnd ? (
                          <span className={cn(late && "font-medium text-crit")}>
                            {shortDate(a.expectedEnd)}
                            {late ? <span className="block text-xs">{relative(a.expectedEnd)}</span> : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill status={late ? "overdue" : a.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )
      ) : transfers.isLoading ? (
        <TableSkeleton cols={5} />
      ) : transfers.isError ? (
        <ErrorNote message="Transfers could not be loaded." />
      ) : !transfers.data?.length ? (
        <EmptyState icon={ArrowLeftRight} title="No transfers recorded" />
      ) : (
        <TableWrap>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {["Tag", "Model", "Reason", "Status", "Requested", "Completed"].map((h) => (
                  <th key={h} className="label-xs px-4 py-2.5 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transfers.data.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/tools/${t.assetId}`}><Tag>{t.tag}</Tag></Link>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{t.modelName}</td>
                  <td className="px-4 py-2.5 capitalize">{String(t.reason).replace(/_/g, " ")}</td>
                  <td className="px-4 py-2.5"><StatusPill status={t.status} /></td>
                  <td className="px-4 py-2.5 text-muted-foreground">{shortDate(t.createdAt)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {t.completedAt ? shortDate(t.completedAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}
