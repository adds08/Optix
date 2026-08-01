"use client";

import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";
import { formatAssetModel } from "@stinventory/types";
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
  The custody line of an entry: who held it, who holds it now, and who typed it.

  A movement with no people in it is a status change, not a hand-off, so this
  renders nothing rather than an arrow pointing at nobody. "The yard" stands in
  for a null custodian — a tool with no holder is in stock, and "→ —" made that
  read like missing data.
*/
function Movement({
  from,
  to,
  actor,
}: {
  from: string | null;
  to: string | null;
  actor: string | null;
}) {
  const moved = from !== to && (from || to);
  if (!moved && !actor) return null;

  return (
    <p className="flex flex-wrap items-center gap-1.5 text-sm">
      {moved ? (
        <>
          <span className="text-muted-foreground">{from ?? "The yard"}</span>
          <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" />
          <span className="font-medium">{to ?? "The yard"}</span>
        </>
      ) : null}
      {actor ? (
        <span className="text-xs text-muted-foreground">
          {moved ? "· recorded by " : "recorded by "}
          {actor}
        </span>
      ) : null}
    </p>
  );
}

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
                  <span className="text-sm text-muted-foreground">
                    {formatAssetModel(e) || "Untagged tool"}
                  </span>
                  {/* "transfer … via transfer" said nothing twice. The ref type
                      only earns its place when it is not just the event again. */}
                  {e.refType && e.refType !== e.eventType ? (
                    <span className="text-xs text-muted-foreground">via {e.refType}</span>
                  ) : null}
                </div>

                {/* Who moved what to whom — the line the log was missing. */}
                <Movement
                  from={e.fromCustodianName}
                  to={e.toCustodianName}
                  actor={e.actorName}
                />

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
