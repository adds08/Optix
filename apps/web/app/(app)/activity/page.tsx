"use client";

import Link from "next/link";
import { Activity } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { Tag } from "@/components/sti/status";
import { dateTime, relative } from "@/lib/format";
import { cn } from "@/lib/utils";

const EVENT_TONE: Record<string, string> = {
  assign: "border-primary",
  transfer: "border-primary",
  return: "border-ok",
  receive: "border-ok",
  found: "border-ok",
  repair_start: "border-warn",
  repair_complete: "border-ok",
  lost: "border-crit",
  dispose: "border-idle",
};

/*
  The audit trail is not a feature bolted on — it IS the transaction log,
  rendered. Nothing here is filtered or editable.
*/
export default function ActivityPage() {
  const events = trpc.transaction.list.useQuery({ limit: 200 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Insight"
        title="Activity"
        description="Every movement, in order. This is the append-only log the whole system derives its state from — which is why the audit trail costs nothing to maintain."
      />

      {events.isLoading ? (
        <TableSkeleton rows={10} cols={4} />
      ) : events.isError ? (
        <ErrorNote message="The activity log could not be loaded." />
      ) : !events.data?.length ? (
        <EmptyState icon={Activity} title="No movements recorded yet" />
      ) : (
        <ol className="relative flex flex-col">
          <span aria-hidden className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
          {events.data.map((e) => (
            <li key={String(e.id)} className="relative flex gap-4 py-3 pl-6">
              <span
                aria-hidden
                className={cn(
                  "absolute left-0 top-[18px] size-[15px] rounded-full border-2 bg-background",
                  EVENT_TONE[e.eventType] ?? "border-muted-foreground",
                )}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label-xs text-foreground">{e.eventType.replace(/_/g, " ")}</span>
                  <Link href={`/tools/${e.assetId}`}>
                    <Tag>{e.tag}</Tag>
                  </Link>
                  <span className="text-sm text-muted-foreground">{e.modelName}</span>
                  {e.refType ? (
                    <span className="text-xs text-muted-foreground">via {e.refType}</span>
                  ) : null}
                </div>
                {e.note ? <p className="text-sm text-pretty">{e.note}</p> : null}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-muted-foreground">{dateTime(e.occurredAt)}</div>
                <div className="text-xs text-muted-foreground/70">{relative(e.occurredAt)}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
