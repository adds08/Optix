"use client";

import { useMemo, useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { AiBriefing } from "@/components/sti/dashboard/ai-briefing";
import { MetricGrid, type Metric } from "@/components/sti/dashboard/metric-grid";
import {
  AttentionFeed,
  type FeedRow,
} from "@/components/sti/dashboard/attention-feed";
import { AiPanel } from "@/components/ai-panel";
import { num } from "@/lib/format";

/*
  The Blocky concept dashboard — what changed, what is stuck, what needs you.

  This is the concept-branch composition of the System Shell v3 dashboard
  (design/blocky-shell-v3/design_handoff_shell/app/(app)/home/dashboard-view.tsx)
  wired to the REAL scoped data instead of the handoff's canned arrays.

  Composition only: the handoff README is explicit that every number arrives
  from `trpc.dashboard.*`, and the current `/home` page already pulls the same
  procedures — `kpis`, `pendingApprovals` and the `report.idle` feed — so this
  view reuses them rather than re-querying. (`clearanceQueue` was in that list
  until 2026-08-27; the offboarding gate it fed was removed and the procedure is
  now unreached rather than gone.) The one genuinely new
  procedure is `dashboard.briefing`, which composes the prose server-side so it
  can never name a tool or a person the caller cannot see.

  Deliberate departures from the design's sample data (docs/09-vocabulary.md,
  the removed loan model):
    - no "OVERDUE" mark — nothing goes overdue since 2026-08-09
    - no "$1.42M on jobs" metric — money figures left the dashboard on 2026-08-09
    - the AI panel is the SAME capture surface as /chat (messaging.send +
      confirm), never a canned script
*/

export function BlockyDashboardView() {
  const { has } = usePermissions();
  const [aiOpen, setAiOpen] = useState(false);

  const seesTools = has("asset.read");
  const kpis = trpc.dashboard.kpis.useQuery(undefined, { enabled: seesTools });
  const approvals = trpc.dashboard.pendingApprovals.useQuery(undefined, { enabled: seesTools });
  const briefing = trpc.dashboard.briefing.useQuery(undefined, { enabled: seesTools });
  const idleReport = trpc.report.idle.useQuery(undefined, { enabled: seesTools });

  const metrics: Metric[] = useMemo(() => {
    const k = kpis.data;
    const idleCount = idleReport.data?.length ?? 0;
    return [
      { value: num(k?.available), label: "In the yard", hint: "available" },
      { value: num(k?.assigned), label: "On jobs", hint: "out with a custodian" },
      { value: num(k?.inMaintenance), label: "In maintenance", hint: "in the shop" },
      { value: num(k?.lost), label: "Unaccounted", hint: "missing", tone: k?.lost ? "crit" : "default" },
      { value: num(k?.missingSerial), label: "No serial", hint: "cannot be identified if stolen", tone: k?.missingSerial ? "warn" : "default" },
      { value: num(idleCount), label: "Idle", hint: "sitting available", tone: idleCount ? "warn" : "default" },
    ];
  }, [kpis.data, idleReport.data]);

  /* The CLEAR rows — a departed employee still holding a tool, marked "HR
     blocked" — came out on 2026-08-27 with the rest of the offboarding gate. */
  const needs: FeedRow[] = useMemo(() => {
    const rows: FeedRow[] = [];
    for (const p of approvals.data ?? []) {
      rows.push({
        mark: "APPROVE",
        tag: p.assetTag ?? "—",
        desc: `${p.type} — ${p.custodianName ?? "—"}`,
        age: "—",
        href: "/custody?tab=queue",
      });
    }
    return rows;
  }, [approvals.data]);

  const stuck: FeedRow[] = useMemo(() => {
    const rows: FeedRow[] = [];
    for (const i of idleReport.data ?? []) {
      rows.push({
        mark: "IDLE",
        tag: i.tag ?? "—",
        desc: "sitting available in the yard",
        age: "—",
        href: "/reports/idle",
      });
    }
    if (kpis.data?.lost) {
      rows.push({ mark: "MISSING", tag: "—", desc: `${kpis.data.lost} tools unaccounted for`, age: "—", href: "/reports/lost" });
    }
    return rows;
  }, [idleReport.data, kpis.data]);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold">Dashboard</h1>
          <p className="text-[11px] text-muted-foreground">
            What changed, what is stuck, what needs you
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setAiOpen(true)}
        >
          <Bot className="size-3.5" aria-hidden />
          Assistant
        </Button>
      </div>

      <AiBriefing text={briefing.data ?? "…"} onOpenChat={() => setAiOpen(true)} />
      <MetricGrid metrics={metrics} />

      <div className="grid gap-3 lg:grid-cols-2">
        <AttentionFeed
          title="Needs you"
          rows={needs}
          emptyText="Nothing waiting on a decision."
        />
        <AttentionFeed
          title="Stuck"
          rows={stuck}
          emptyText="Nothing unaccounted for or sitting idle."
        />
      </div>

      <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}
