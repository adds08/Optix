"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Handshake, UserMinus } from "lucide-react";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { isFieldRole } from "@/components/sti/nav-config";
import { PageHeader, Metric, EmptyState } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { Skeleton } from "@/components/ui/skeleton";
import { dateTime, money, num, relative } from "@/lib/format";

/*
  The desk dashboard answers one question first: what needs a person today.
  Counts come second. A dashboard that leads with totals and buries the six
  overdue loans is a dashboard people stop opening.
*/
export default function HomePage() {
  const router = useRouter();
  const { role } = usePermissions();

  /* Field roles get their own landing surface. */
  useEffect(() => {
    if (isFieldRole(role)) router.replace("/my-tools");
  }, [role, router]);

  const kpis = trpc.dashboard.kpis.useQuery();
  const overdue = trpc.dashboard.overdueLoans.useQuery();
  const clearance = trpc.dashboard.clearanceQueue.useQuery();
  const approvals = trpc.dashboard.pendingApprovals.useQuery();
  const activity = trpc.dashboard.recentActivity.useQuery();
  const capitalJobs = trpc.report.capitalByProject.useQuery();
  const capitalShop = trpc.report.capitalByDepartment.useQuery();
  const idleReport = trpc.report.idle.useQuery();

  const k = kpis.data;

  /*
    "Awaiting approval" and "Awaiting verification" are different questions and
    different answers: may this happen, versus this already happened, is the
    record right. They share one query (the pendingApprovals procedure already
    returns both) and split on the client here — no backend change for a card.
  */
  const all = approvals.data ?? [];
  const holds = all.filter((a) => a.status === "pending_approval");
  const borrows = all.filter((a) => a.status === "pending_verification");

  /* `attention` sums the FULL approvals list, holds and borrows together. The
     empty state it decides is only honest when a borrow that has not been
     verified still keeps it off the screen. */
  const attention =
    (overdue.data?.length ?? 0) + (clearance.data?.length ?? 0) + all.length;

  const capitalOnJobs = (capitalJobs.data ?? []).reduce((s, r) => s + Number(r.capitalValue), 0);
  const capitalInShop = (capitalShop.data ?? []).reduce((s, r) => s + Number(r.capitalValue), 0);
  const idleCount = idleReport.data?.length ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Overview"
        title="Equipment desk"
        description="Everything below is folded from the transaction log — the same source the reports read."
      />

      {/* ---- needs attention, first ---- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Needs a person</h2>

        {overdue.isLoading || clearance.isLoading || approvals.isLoading ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}
          </div>
        ) : attention === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing is waiting"
            description="No overdue loans, no clearance queue, and no approvals or hand-offs pending. The yard is square."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-4">
            <AttentionCard
              tone="crit"
              icon={AlertTriangle}
              title="Overdue loans"
              count={overdue.data?.length ?? 0}
              href="/custody"
              empty="No loan is past its due date."
            >
              {(overdue.data ?? []).slice(0, 4).map((o) => (
                <Row
                  key={o.id}
                  left={<Tag>{o.tag}</Tag>}
                  mid={o.custodianName ?? "—"}
                  right={
                    <span className="text-crit tnum">
                      {o.daysOverdue}d over
                    </span>
                  }
                />
              ))}
            </AttentionCard>

            <AttentionCard
              tone="crit"
              icon={UserMinus}
              title="HR clearance"
              count={clearance.data?.length ?? 0}
              href="/people"
              empty="No terminated employee is still holding a tool."
            >
              {(clearance.data ?? []).slice(0, 4).map((c, i) => (
                <Row
                  key={i}
                  left={<Tag>{c.tag}</Tag>}
                  mid={c.custodianName ?? "—"}
                  right={<StatusPill status={c.status} />}
                />
              ))}
            </AttentionCard>

            <AttentionCard
              tone="warn"
              icon={AlertTriangle}
              title="Awaiting approval"
              count={holds.length}
              href="/inbox"
              empty="No hand-off is waiting on a signature."
            >
              {holds.slice(0, 4).map((p) => (
                <Row
                  key={p.id}
                  left={<Tag>{p.assetTag}</Tag>}
                  mid={`${p.type} · ${p.custodianName ?? "—"}`}
                  right={<span className="text-muted-foreground">{relative(p.createdAt)}</span>}
                />
              ))}
            </AttentionCard>

            <AttentionCard
              tone="warn"
              icon={Handshake}
              title="Loans to verify"
              count={borrows.length}
              href="/inbox"
              empty="No foreman hand-off is waiting to be checked."
            >
              {borrows.slice(0, 4).map((p) => (
                <Row
                  key={p.id}
                  left={<Tag>{p.assetTag}</Tag>}
                  mid={`${p.fromName ?? "Somebody"} → ${p.custodianName ?? "—"}`}
                  right={<span className="text-muted-foreground">{relative(p.createdAt)}</span>}
                />
              ))}
            </AttentionCard>
          </div>
        )}
      </section>

      {/* ---- the numbers ---- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Fleet at a glance</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Available" value={num(k?.available)} loading={kpis.isLoading} hint="ready to issue" />
          <Metric label="Assigned" value={num(k?.assigned)} loading={kpis.isLoading} hint="out with a custodian" />
          <Metric label="In maintenance" value={num(k?.inMaintenance)} loading={kpis.isLoading} tone={k?.inMaintenance ? "warn" : "default"} />
          <Metric label="Lost" value={num(k?.lost)} loading={kpis.isLoading} tone={k?.lost ? "crit" : "ok"} hint="unaccounted for" />
          <Metric label="Fleet value" value={money(k?.fleetValue)} loading={kpis.isLoading} hint="acquisition cost" />
          <Metric label="Capital on jobs" value={money(capitalOnJobs)} loading={capitalJobs.isLoading} hint="charged to projects" />
          <Metric label="Capital in the shop" value={money(capitalInShop)} loading={capitalShop.isLoading} hint="charged to departments" />
          <Metric label="Reserved" value={num(k?.reserved)} loading={kpis.isLoading} />
          {/* Honest placeholder: the maintenance module has no tables yet, so
              zero is the only true answer. Rendering the tile anyway keeps the
              dashboard's shape stable while the module is being built. */}
          <Metric
            label="Scheduled maintenance"
            value={num(k?.scheduledMaint)}
            loading={kpis.isLoading}
            hint="maintenance module not built yet"
          />
          <Metric
            label="Missing serials"
            value={num(k?.missingSerial)}
            loading={kpis.isLoading}
            tone={k?.missingSerial ? "warn" : "ok"}
            hint="serialized tools that cannot be identified if stolen"
          />
          <Link href="/reports/idle" className="block transition-opacity hover:opacity-80">
            <Metric
              label="Idle tools"
              value={num(idleCount)}
              loading={idleReport.isLoading}
              tone={idleCount ? "warn" : "ok"}
              hint="sitting available — see the Idle report"
            />
          </Link>
          <Metric label="Terminated staff" value={num(k?.terminatedCount)} loading={kpis.isLoading} />
          <Metric label="Held by terminated" value={num(k?.clearanceCount)} loading={kpis.isLoading} tone={k?.clearanceCount ? "crit" : "ok"} />
        </div>
      </section>

      {/* ---- activity ---- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Latest movements</h2>
          <Link href="/activity" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            Full audit trail <ArrowRight className="size-3.5" />
          </Link>
        </div>
        {activity.isLoading ? (
          <Skeleton className="h-48" />
        ) : !activity.data?.length ? (
          <EmptyState title="No movements recorded yet" />
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
            {activity.data.slice(0, 8).map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 bg-card px-4 py-2.5 text-sm">
                <span className="label-xs w-24 shrink-0 text-foreground">
                  {String(a.eventType ?? "").replace(/_/g, " ")}
                </span>
                <Tag>{a.assetTag}</Tag>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {a.note ?? formatAssetModel({ make: a.assetMake, modelNumber: a.assetModelNumber, description: a.assetDescription }) ?? "Untagged tool"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{dateTime(a.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AttentionCard({
  tone,
  icon: Icon,
  title,
  count,
  href,
  empty,
  children,
}: {
  tone: "crit" | "warn";
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  href: string;
  empty: string;
  children: React.ReactNode;
}) {
  const accent = tone === "crit" ? "text-crit" : "text-warn";
  const edge = tone === "crit" ? "border-t-crit" : "border-t-warn";
  return (
    <div className={`flex flex-col gap-3 rounded-md border border-t-[3px] ${edge} bg-card p-4`}>
      <div className="flex items-center gap-2">
        <Icon className={`size-4 ${accent}`} />
        <span className="text-sm font-medium">{title}</span>
        <span className={`tnum ml-auto text-2xl font-semibold ${count ? accent : "text-muted-foreground"}`}>
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">{children}</div>
          <Link href={href} className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-primary hover:underline">
            Work the queue <ArrowRight className="size-3.5" />
          </Link>
        </>
      )}
    </div>
  );
}

function Row({ left, mid, right }: { left: React.ReactNode; mid: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {left}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{mid}</span>
      <span className="shrink-0 text-xs">{right}</span>
    </div>
  );
}
