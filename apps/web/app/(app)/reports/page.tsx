"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { money, num } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { REPORTS } from "./registry";

/*
  The reports hub. Each card carries a live headline figure, so this page
  answers the common question ("how many are idle?") without anyone having to
  open the report at all. Reports are the moat — they get the front door.

  The group chips (docs/20, C2) classify the surface: Operations, Utilization,
  Exceptions, Finance, Charts, Logs. The audit trail lives here too — it is
  the single history for activity and logs, so there is no separate Activity
  page to keep in sync with the dashboard's strip.
*/
export default function ReportsPage() {
  const register = trpc.report.assetRegister.useQuery();
  const idle = trpc.report.idle.useQuery();
  const lost = trpc.report.lost.useQuery();
  const byProject = trpc.report.byProject.useQuery();
  const byForeman = trpc.report.byForeman.useQuery();
  const capital = trpc.report.capitalByProject.useQuery();

  const groups = useMemo(() => Array.from(new Set(REPORTS.map((r) => r.group))), []);
  const [group, setGroup] = useState<string>("all");

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

  const visible = REPORTS.filter((r) => group === "all" || r.group === group);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Report group">
        <GroupChip active={group === "all"} onClick={() => setGroup("all")}>All</GroupChip>
        {groups.map((g) => (
          <GroupChip key={g} active={group === g} onClick={() => setGroup(g)}>{g}</GroupChip>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((r) => {
          const h = headline[r.slug];
          return (
            <Link
              key={r.slug}
              href={r.path ?? `/reports/${r.slug}`}
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
              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">{r.description}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function GroupChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-sm border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary/40 bg-primary/10 font-medium text-primary"
          : "border-border bg-card text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
