"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/sti/page";
import { money, num } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { REPORTS } from "./registry";

/*
  The reports hub. Each card carries a live headline figure, so this page
  answers the common question ("how many are idle?") without anyone having to
  open the report at all. Reports are the moat — they get the front door.
*/
export default function ReportsPage() {
  const register = trpc.report.assetRegister.useQuery();
  const idle = trpc.report.idle.useQuery();
  const lost = trpc.report.lost.useQuery();
  const byProject = trpc.report.byProject.useQuery();
  const byForeman = trpc.report.byForeman.useQuery();
  const capital = trpc.report.capitalByProject.useQuery();

  const headline: Record<string, { value: string; loading: boolean }> = {
    "asset-register": {
      value: num(register.data?.length),
      loading: register.isLoading,
    },
    "by-project": {
      value: num(byProject.data?.filter((r) => Number(r.assetCount) > 0).length),
      loading: byProject.isLoading,
    },
    "by-foreman": {
      value: num(byForeman.data?.filter((r) => Number(r.assetCount) > 0).length),
      loading: byForeman.isLoading,
    },
    idle: { value: num(idle.data?.length), loading: idle.isLoading },
    lost: {
      value: money(lost.data?.reduce((s, r) => s + Number(r.acquisitionCost ?? 0), 0)),
      loading: lost.isLoading,
    },
    "capital-by-project": {
      value: money(capital.data?.reduce((s, r) => s + Number(r.capitalValue ?? 0), 0)),
      loading: capital.isLoading,
    },
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Insight"
        title="Reports"
        description="Every report is folded from the same transaction log, so the numbers here and the numbers on the dashboard can never disagree. All exportable to CSV."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r) => {
          const h = headline[r.slug];
          return (
            <Link
              key={r.slug}
              href={`/reports/${r.slug}`}
              className="group flex flex-col gap-3 rounded-md border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="label-xs">{r.group}</span>
                  <h2 className="font-medium tracking-tight">{r.title}</h2>
                </div>
                <r.icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
              </div>

              {h?.loading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className="tnum text-2xl font-semibold tracking-tight">{h?.value ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">{r.headlineLabel}</span>
                </div>
              )}

              <p className="text-sm text-muted-foreground text-pretty">{r.description}</p>

              <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-primary">
                Open report
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">
        Utilization, maintenance history, procurement status and a transfers report are specified in
        the plan but not yet built — utilization needs a window function over the event stream, and
        the other two are blocked on the maintenance and procurement modules.
      </p>
    </div>
  );
}
