"use client";

import { useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  EyeOff,
  MapPin,
  Pencil,
  Tag as TagIcon,
  TriangleAlert,
  Undo2,
  UserPlus,
  Wrench,
} from "lucide-react";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { Tag } from "@/components/sti/status";
import { cn } from "@/lib/utils";

/*
  The live jobsite feed — what is moving on this site, right now.

  It polls the append-only ledger every 20 seconds (and refreshes whenever the
  tab regains focus), so a transfer, return or repair that lands while the desk
  is looking shows up on its own. Pick a site in the header to watch one job;
  "All sites" shows the whole fleet's latest.

  No new infrastructure: the transaction log IS the audit trail, and this panel
  is just a scoped, polling window onto it.
*/

const EVENT_META: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  assign: { icon: UserPlus, label: "Assigned" },
  transfer: { icon: ArrowLeftRight, label: "Handed over" },
  return: { icon: Undo2, label: "Returned" },
  custodian_change: { icon: UserPlus, label: "Custody changed" },
  project_change: { icon: MapPin, label: "Moved to a new job" },
  repair_start: { icon: Wrench, label: "Sent for repair" },
  lost: { icon: TriangleAlert, label: "Reported missing" },
  status_change: { icon: Pencil, label: "Status changed" },
  tag: { icon: TagIcon, label: "Tagged" },
};

/* "3m ago" rather than the day-scale relative() — this panel is about the
   last hour, not the last month. */
function timeAgo(v: string | Date): string {
  const ms = Date.now() - new Date(v).getTime();
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

export function JobsiteActivity({
  projectOptions,
  onHide,
}: {
  projectOptions: { id: string; name: string }[];
  onHide?: () => void;
}) {
  const [projectId, setProjectId] = useState("");

  const feed = trpc.transaction.list.useQuery(
    { limit: 30, projectId: projectId || undefined },
    /* Poll while the panel is open. A 20s tick keeps the desk honest without
       hammering the API; the tab-focus refetch covers the in-between. */
    { refetchInterval: 20_000 },
  );

  const rows = feed.data ?? [];

  return (
    <section className="flex flex-col overflow-hidden rounded-md border bg-card">
      <header className="flex items-center gap-2 border-b bg-primary/5 px-3 py-2.5">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-ok" />
        </span>
        <h2 className="text-sm font-semibold">Activity</h2>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Watch a specific jobsite"
          className="ml-auto h-7 max-w-40 rounded-md border border-input bg-transparent px-1.5 text-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">All sites</option>
          {projectOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {onHide ? (
          <button
            type="button"
            onClick={onHide}
            aria-label="Hide activity panel"
            title="Hide activity"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <EyeOff className="size-3.5" />
          </button>
        ) : null}
      </header>

      <div className="max-h-[28rem] overflow-y-auto">
        {feed.isLoading ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : !rows.length ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No activity{projectId ? " on this site" : ""} yet.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => {
              const meta = EVENT_META[r.eventType] ?? { icon: Activity, label: "Updated" };
              const Icon = meta.icon;
              const title = r.tag ?? (formatAssetModel(r) || "A tool");
              return (
                <li key={r.id} className="flex gap-2.5 px-3 py-2">
                  <span
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted",
                      r.eventType === "lost" && "bg-crit/10 text-crit",
                      r.eventType === "repair_start" && "bg-warn/10 text-warn",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">
                      <span className="font-medium">{title}</span>{" "}
                      <span className="text-muted-foreground">{meta.label.toLowerCase()}</span>
                      {r.toCustodianName ? (
                        <span className="text-muted-foreground"> to {r.toCustodianName}</span>
                      ) : null}
                    </p>
                    {r.note ? (
                      <p className="truncate text-xs text-muted-foreground">{r.note}</p>
                    ) : (
                      <p className="truncate text-xs text-muted-foreground">
                        {formatAssetModel(r) || "Untagged tool"}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {timeAgo(r.occurredAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        Updates every 20s · <Tag>live</Tag>
      </footer>
    </section>
  );
}
