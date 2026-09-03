"use client";

import { Check, CheckCircle2, CircleAlert, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { EmptyState, TableSkeleton, ErrorNote, PageHeader } from "@/components/sti/page";
import { StatusPill } from "@/components/sti/status";
import { Button } from "@/components/ui/button";
import { dateTime, relative } from "@/lib/format";

/*
  The intelligent inbox (docs/19).

  Everything the desk can act on, in three honest buckets:

  - Recognized: an action that can be replayed. One click ("Do it") settles it
    through the same executor as the chat Confirm button and the old approve
    button — `inbox.resolve` shares their code, so the ledger cannot tell the
    surfaces apart.
  - Unrecognized: the model could not bind this to an action. "Try again"
    re-queues it for the LLM; "Dismiss" closes it with a reason, keeping the
    row in history.
  - Completed: signed off, declined, or dismissed. History, not work.

  The whole page polls at the inbox cadence: nothing here is caused by the
  person looking at it, so a request arriving from the field has to appear
  without anybody pressing refresh.
*/

export default function InboxPage() {
  const { has } = usePermissions();
  const isDesk = has("assignment.read");
  const live = { refetchInterval: 15_000 };

  const alerts = trpc.notification.list.useQuery(undefined, { ...live, enabled: !isDesk });
  const classified = trpc.inbox.classified.useQuery({ limit: 50 }, { ...live, enabled: isDesk });

  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.inbox.classified.invalidate();
    utils.dashboard.notifications.invalidate();
  };
  const resolve = trpc.inbox.resolve.useMutation({ onSuccess: invalidate });
  const dismiss = trpc.inbox.dismiss.useMutation({ onSuccess: invalidate });
  const retry = trpc.inbox.retryClassify.useMutation({ onSuccess: invalidate });
  const decline = trpc.task.decline.useMutation({ onSuccess: invalidate });

  const c = classified.data;
  const unread = [...(alerts.data ?? [])].filter((n) => !n.readAt);

  /* Non-desk roles see their own alerts here — their nav item is "Alerts". */
  if (!isDesk) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Alerts"
          hideTitle
          description="Notifications about your tools and the requests you have sent."
        />
        {alerts.isLoading ? (
          <TableSkeleton cols={2} />
        ) : !unread.length ? (
          <EmptyState icon={CheckCircle2} title="Nothing unread" description="You are all caught up." />
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
            {unread.map((n) => (
              <li key={n.id} className="flex flex-col gap-0.5 bg-card px-4 py-3 text-sm">
                <span className="font-medium">{n.title}</span>
                {n.body ? <span className="text-muted-foreground">{n.body}</span> : null}
                <span className="text-xs text-muted-foreground">{dateTime(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const askDecline = (id: string, title: string) => {
    const reason = window.prompt(`Why decline "${title}"?`);
    if (reason === null) return;
    decline.mutate({ id, reason: reason || "Declined from the inbox" });
  };

  /* UI-72: this asked "Why is nothing being recorded?" — copy that belongs to
     resolve-message.tsx, whose button IS labelled "Nothing to record". Under a
     button labelled "Dismiss" it named neither the action nor its subject, and
     since window.prompt offers only OK/Cancel the copy has to say what each one
     does. Names the item, like askDecline above. The reason stays optional —
     the server defaults it. */
  const askDismiss = (id: string, kind: "task" | "message", title: string) => {
    const reason = window.prompt(
      `Dismiss "${title}"? It stays in history and nothing is recorded.\n\nReason (optional). Cancel keeps it in the inbox.`,
    );
    if (reason === null) return;
    dismiss.mutate({ id, kind, reason: reason || undefined });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inbox"
        hideTitle
        description="The desk&apos;s queue — requests the parser recognized, ones it did not, and what has already been settled."
      />
      {/* No metric row: the three buckets are the page, and each heading below
          carries its own count. Cards on top only delayed the first item. */}
      {classified.isLoading ? (
        <TableSkeleton cols={3} />
      ) : classified.isError ? (
        <ErrorNote message="The inbox could not be loaded." />
      ) : (
        <div className="flex flex-col gap-8">
          {/* ---- recognized: do the thing ---- */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-warn" />
              <h2 className="text-sm font-medium">
                Recognized tasks <span className="tnum text-muted-foreground">{c?.recognized.length ?? 0}</span>
              </h2>
            </div>
            {!c?.recognized.length ? (
              <EmptyState title="Nothing actionable" description="No request or hand-off is waiting to be settled." />
            ) : (
              <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
                {c.recognized.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 bg-card px-4 py-3 text-sm">
                    <StatusPill status={item.status} className="shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{item.title}</span>
                      {item.summary ? <span className="truncate text-xs text-muted-foreground">{item.summary}</span> : null}
                      {item.actionType ? (
                        <span className="label-xs mt-0.5 normal-case tracking-normal text-muted-foreground">
                          {item.actionType.replace(/_/g, " ")}
                          {item.department ? ` · ${item.department}` : ""}
                        </span>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{relative(item.createdAt)}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        size="sm"
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ id: item.id, kind: item.kind })}
                      >
                        {resolve.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        Do it
                      </Button>
                      {item.kind === "task" && item.actionType ? (
                        <Button size="sm" variant="outline" onClick={() => askDecline(item.id, item.title)}>
                          Decline
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- unrecognized: resolve or dismiss ---- */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CircleAlert className="size-4 text-warn" />
              <h2 className="text-sm font-medium">
                Unrecognized <span className="tnum text-muted-foreground">{c?.unrecognized.length ?? 0}</span>
              </h2>
            </div>
            {!c?.unrecognized.length ? (
              <EmptyState title="Everything is understood" description="No item is stuck without a binding." />
            ) : (
              <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
                {c.unrecognized.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 bg-card px-4 py-3 text-sm">
                    <StatusPill status={item.status} className="shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{item.title}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {item.kind === "message" ? "message" : "note"} · {relative(item.createdAt)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {item.kind === "message" ? (
                        <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: item.id, kind: "message" })}>
                          <RefreshCw className="size-3.5" />
                          Try again
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" onClick={() => askDismiss(item.id, item.kind, item.title)}>
                        <X className="size-3.5" />
                        Dismiss
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- completed: history ---- */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">
              Completed <span className="tnum text-muted-foreground">{c?.completed.length ?? 0}</span>
            </h2>
            {!c?.completed.length ? (
              <EmptyState title="No history yet" />
            ) : (
              <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
                {c.completed.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 bg-card px-4 py-2.5 text-sm text-muted-foreground">
                    <StatusPill status={item.status} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className="shrink-0 text-xs">{dateTime(item.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
