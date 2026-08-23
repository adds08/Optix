"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiBriefing } from "@/components/sti/dashboard/ai-briefing";
import { MetricGrid, type Metric } from "@/components/sti/dashboard/metric-grid";
import {
  AttentionFeed,
  type FeedRow,
} from "@/components/sti/dashboard/attention-feed";
import { AiPanel, type ChatSession } from "@/components/sti/ai-panel";

/*
  The desk dashboard: what changed, what is stuck, what needs you.

  Composition only — every number arrives as a prop so this file stays a
  layout decision and nothing else. It lives inside AppShell's scroll region,
  so it sizes against its parent and never against the viewport.
*/

// TODO(api): replace with trpc.dashboard.metrics — docs/14-dashboard-additions.md
const METRICS: Metric[] = [
  { value: "1,284", label: "In register", hint: "total tools" },
  { value: "62", label: "In the yard", hint: "available" },
  { value: "4", label: "Unaccounted", hint: "missing", tone: "crit" },
  { value: "2", label: "No serial", hint: "at risk", tone: "warn" },
  { value: "$1.42M", label: "On jobs", hint: "capital" },
  { value: "$84.2K", label: "Idle value", hint: "in yard", tone: "warn" },
];

// TODO(api): replace with trpc.dashboard.needsYou
const NEEDS: FeedRow[] = [
  { mark: "CHECK", tag: "UIC-1042", desc: "Ruiz gave rotary hammer to Barnes — temp loan", age: "2h", href: "/tools/UIC-1042" },
  { mark: "CHECK", tag: "UIC-0902", desc: "Okafor handed total station to Vega", age: "5h", href: "/tools/UIC-0902" },
  { mark: "APPROVE", tag: "UIC-1355", desc: "Torque wrench requested for Cedar Hill", age: "1d", href: "/inbox" },
  { mark: "APPROVE", tag: "GB-2", desc: "Gang box moving to Frisco — 14 tools follow", age: "1d", href: "/inbox" },
  { mark: "CLEAR", tag: "—", desc: "Whitaker left Friday, HR blocked on 4 tools", age: "4d", href: "/people" },
];

// TODO(api): replace with trpc.dashboard.stuck
const STUCK: FeedRow[] = [
  { mark: "OVERDUE", tag: "UIC-1190", desc: "Laser level 11d past due, nobody returned it", age: "11d", href: "/tools/UIC-1190" },
  { mark: "OVERDUE", tag: "UIC-0774", desc: "Quikie saw due back Tuesday", age: "3d", href: "/tools/UIC-0774" },
  { mark: "MISSING", tag: "UIC-1477", desc: "Plate tamper damaged 14d ago, never came in", age: "14d", href: "/tools/UIC-1477" },
  { mark: "IDLE", tag: "—", desc: "Phase 2 closed — 22 tools sitting idle", age: "6d", href: "/jobsites" },
  { mark: "NO SN", tag: "UIC-0774", desc: "2 tagged tools have no serial number", age: "—", href: "/tools" },
];

// TODO(api): replace with trpc.chat.sessions
const SESSIONS: ChatSession[] = [
  {
    id: "s1",
    title: "Tool custody questions",
    time: "Today",
    messages: [
      {
        role: "ai",
        text: "Two hand-offs came in overnight — both temporary loans needing verification. Whitaker left Friday still holding 4 tools, HR sign-off blocked.",
      },
    ],
  },
];

const BRIEFING =
  "Two hand-offs came in overnight — both temporary loans needing verification. Whitaker left Friday still holding 4 tools, HR sign-off blocked. The laser level on TXDOT is 11 days past due.";

export function DashboardView() {
  const [aiOpen, setAiOpen] = useState(false);
  const [sessions, setSessions] = useState(SESSIONS);
  const [activeId, setActiveId] = useState(SESSIONS[0].id);

  function send(text: string) {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId
          ? { ...s, messages: [...s.messages, { role: "user", text }] }
          : s,
      ),
    );
    // TODO(api): trpc.chat.send.mutate({ sessionId: activeId, text })
  }

  function newSession() {
    const id = `s${sessions.length + 1}`;
    setSessions((prev) => [
      ...prev,
      { id, title: "New conversation", time: "Just now", messages: [] },
    ]);
    setActiveId(id);
  }

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

      <AiBriefing text={BRIEFING} onOpenChat={() => setAiOpen(true)} />
      <MetricGrid metrics={METRICS} />

      <div className="grid gap-3 lg:grid-cols-2">
        <AttentionFeed
          title="Needs you"
          rows={NEEDS}
          emptyText="Nothing waiting on a decision."
        />
        <AttentionFeed
          title="Stuck"
          rows={STUCK}
          emptyText="Nothing overdue or unaccounted for."
        />
      </div>

      <AiPanel
        open={aiOpen}
        onOpenChange={setAiOpen}
        sessions={sessions}
        activeSessionId={activeId}
        onSelectSession={setActiveId}
        onNewSession={newSession}
        onSend={send}
      />
    </div>
  );
}
