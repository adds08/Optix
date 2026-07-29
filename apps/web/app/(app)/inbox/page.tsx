"use client";

import { useState } from "react";
import { Bell, CheckCircle2, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { ResolveMessage } from "@/components/resolve-message";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, Metric } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { Button } from "@/components/ui/button";
import { dateTime, relative } from "@/lib/format";

/*
  Two audiences, one route.

  The desk reaches this as "Inbox" and needs the work queue: unresolved
  messages, hand-offs waiting on a signature, requests from the field. A foreman
  reaches the SAME route as "Alerts" (see nav-config) and needs the opposite —
  what happened to the things they asked for.

  That second half did not exist. Approving or declining a request wrote a
  notification, and on web nothing ever displayed it, so from the field a
  decision looked identical to being ignored. Notifications now come first, for
  everyone; the desk queue below them is gated on actually being able to act on
  it, rather than showing a foreman buttons that can only return 403.
*/
export default function InboxPage() {
  const utils = trpc.useUtils();
  /* The message the desk is turning into a record, if any. */
  const [resolving, setResolving] = useState<{ id: string; body: string } | null>(null);
  const { has } = usePermissions();
  /* `assignment.read` is what the desk sections need to be worth showing —
     it is the permission the nav already gates the desk Inbox on. */
  const isDesk = has("assignment.read");

  /*
    Polled, because everything on this page arrives from somewhere else.

    Nothing here is caused by the person looking at it — a foreman sends a
    message from the field app, the worker parses it a second or two later, and
    it lands in one of these lists. Without a poll the desk had to know to
    reload, so "I sent it and it never showed up" was a page that had simply
    stopped asking. Fifteen seconds against four small queries is nothing next
    to a request sitting unseen.
  */
  const live = { refetchInterval: 15_000 };

  const alerts = trpc.notification.list.useQuery(undefined, live);
  const pending = trpc.messaging.pendingActions.useQuery({ limit: 50 }, { ...live, enabled: isDesk });
  const approvals = trpc.dashboard.pendingApprovals.useQuery(undefined, { ...live, enabled: isDesk });
  const tasks = trpc.task.list.useQuery({ limit: 50 }, { ...live, enabled: isDesk });

  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => utils.notification.list.invalidate(),
  });

  /* Newest first: a decision from an hour ago matters more than one from
     last week, and the query returns oldest-first. */
  const unread = [...(alerts.data ?? [])]
    .filter((n) => !n.readAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const taskItems = Array.isArray(tasks.data) ? tasks.data : (tasks.data?.items ?? []);
  const openTasks = taskItems.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  /* A request carries the action it will perform; a note is just work to do.
     They need different controls, so they are shown apart. */
  const requests = openTasks.filter((t) => !!t.actionType && !!t.pendingAction);
  const notes = openTasks.filter((t) => !t.actionType || !t.pendingAction);
  const total =
    unread.length + (pending.data?.length ?? 0) + (approvals.data?.length ?? 0) + openTasks.length;

  const loading =
    alerts.isLoading || (isDesk && (pending.isLoading || approvals.isLoading || tasks.isLoading));

  return (
    <div className="flex flex-col gap-6">
      {resolving ? (
        <ResolveMessage
          open
          onClose={() => setResolving(null)}
          messageId={resolving.id}
          body={resolving.body}
        />
      ) : null}
      <PageHeader
        eyebrow="Operations"
        title={isDesk ? "Inbox" : "Alerts"}
        description={
          isDesk
            ? "Everything waiting on a person at the equipment desk."
            : "What came back on the things you reported."
        }
      />

      {isDesk ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            label="Unresolved messages"
            value={pending.data?.length ?? 0}
            loading={pending.isLoading}
            tone={pending.data?.length ? "warn" : "ok"}
            hint="parser could not match a tool"
          />
          <Metric
            label="Awaiting approval"
            value={approvals.data?.length ?? 0}
            loading={approvals.isLoading}
            tone={approvals.data?.length ? "warn" : "ok"}
            hint="hand-offs needing a second signature"
          />
          <Metric
            label="Field requests"
            value={requests.length}
            loading={tasks.isLoading}
            tone={requests.length ? "warn" : "ok"}
            hint="raised by someone without the permission"
          />
        </div>
      ) : null}

      {loading ? (
        <TableSkeleton rows={5} cols={3} />
      ) : total === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={isDesk ? "Inbox zero" : "Nothing waiting on you"}
          description={
            isDesk
              ? "No unresolved messages, no approvals pending, no open tasks."
              : "Nothing you reported is waiting on an answer."
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {/* What came back — approvals, refusals, overdue chasers. Shown to
              everyone, and first, because on the field side it is the only
              thing on this page that concerns them. */}
          {unread.length ? (
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Bell className="size-4 text-primary" />
                <h2 className="text-sm font-medium">
                  Your alerts <span className="text-muted-foreground">({unread.length})</span>
                </h2>
              </div>
              <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
                {unread.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-start gap-3 bg-card px-4 py-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        className={`text-sm font-medium ${
                          n.type === "request_declined" ? "text-crit" : ""
                        }`}
                      >
                        {n.title}
                      </span>
                      {n.body ? (
                        <span className="text-sm text-muted-foreground">{n.body}</span>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {relative(n.createdAt)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={markRead.isPending}
                      onClick={() => markRead.mutate({ id: n.id })}
                    >
                      Got it
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* unresolved chat */}
          {pending.data?.length ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">
                Messages needing a human <span className="text-muted-foreground">({pending.data.length})</span>
              </h2>
              {pending.isError ? (
                <ErrorNote message="Could not load the verification queue." />
              ) : (
                <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
                  {pending.data.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-start gap-3 bg-card px-4 py-3">
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="text-sm">{m.body}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill status={m.processingStatus} />
                          {m.intentType ? (
                            <span className="label-xs normal-case tracking-normal">
                              read as “{m.intentType}”
                            </span>
                          ) : null}
                          {m.errorNote ? (
                            <span className="text-xs text-crit">{m.errorNote}</span>
                          ) : null}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {dateTime(m.createdAt)}
                      </span>
                      <Button size="sm" onClick={() => setResolving({ id: m.id, body: m.body })}>
                        Resolve
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-muted-foreground">
                The parser could not match these to a tool. Resolve one to record what it should
                have said, or close it if there is nothing to record — either way it leaves the
                queue and the sender is told.
              </p>
            </section>
          ) : null}

          {/* approvals */}
          {approvals.data?.length ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">
                Awaiting approval <span className="text-muted-foreground">({approvals.data.length})</span>
              </h2>
              <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
                {approvals.data.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 bg-card px-4 py-3 text-sm">
                    <Tag>{a.assetTag}</Tag>
                    <span className="font-medium">{a.assetModel}</span>
                    <span className="text-muted-foreground">
                      {a.type} · {a.custodianName ?? "—"}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{relative(a.createdAt)}</span>
                    <ApprovalControls
                      type={a.type}
                      id={a.id}
                      onDone={() => {
                        utils.dashboard.pendingApprovals.invalidate();
                        utils.asset.list.invalidate();
                        utils.assignment.list.invalidate();
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* requests raised from the field — these carry an action to run */}
          {requests.length ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">
                Requests from the field{" "}
                <span className="text-muted-foreground">({requests.length})</span>
              </h2>
              <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
                {requests.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-start gap-3 bg-card px-4 py-3 text-sm">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="font-medium">{t.title}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Say what pressing Approve will actually do. */}
                        <span className="text-xs text-muted-foreground">
                          Approving will {REQUEST_COPY[t.actionType ?? ""] ?? "record this"}.
                        </span>
                        {t.department ? (
                          <span className="label-xs normal-case tracking-normal">{t.department}</span>
                        ) : null}
                        {t.priority === "high" || t.priority === "urgent" ? (
                          <span className="label-xs text-crit">{t.priority}</span>
                        ) : null}
                        {t.escalationCount ? (
                          <span className="label-xs text-warn">
                            chased {t.escalationCount}×
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {relative(t.createdAt)}
                    </span>
                    <RequestControls
                      task={t}
                      onDone={() => {
                        utils.task.list.invalidate();
                        utils.asset.list.invalidate();
                        utils.dashboard.pendingApprovals.invalidate();
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* notes — nothing to approve, they just need doing */}
          {notes.length ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">
                Tasks from the field <span className="text-muted-foreground">({notes.length})</span>
              </h2>
              <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
                {notes.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 bg-card px-4 py-3 text-sm">
                    <span className="font-medium">{t.title}</span>
                    <StatusPill status={t.status} />
                    <span className="label-xs normal-case tracking-normal">{t.priority}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{relative(t.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

/*
  Approve or refuse a custody hand-off waiting on a second signature.

  This used to be a disabled placeholder whose comment said the endpoints were
  REST-only. They are not — `assignment.approve` and `transfer.approve` are
  tRPC procedures and have been for some time, so the button simply never got
  connected. Refusing needs to be possible from the same row: an approval gate
  where the only option is "yes" is not a gate.
*/
function ApprovalControls({
  type,
  id,
  onDone,
}: {
  type: string;
  id: string;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const settled = () => {
    setError(null);
    onDone();
  };
  const failed = (e: unknown) => setError(e instanceof Error ? e.message : "That did not go through.");

  const approveAssignment = trpc.assignment.approve.useMutation({ onSuccess: settled, onError: failed });
  const declineAssignment = trpc.assignment.decline.useMutation({ onSuccess: settled, onError: failed });
  const approveTransfer = trpc.transfer.approve.useMutation({ onSuccess: settled, onError: failed });
  const declineTransfer = trpc.transfer.decline.useMutation({ onSuccess: settled, onError: failed });

  const isTransfer = type === "transfer";
  const approve = isTransfer ? approveTransfer : approveAssignment;
  const decline = isTransfer ? declineTransfer : declineAssignment;
  const busy = approve.isPending || decline.isPending;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            const reason = window.prompt("Why is this not approved?");
            if (reason === null) return;
            decline.mutate({ id, reason: reason || undefined });
          }}
        >
          Decline
        </Button>
        <Button size="sm" disabled={busy} onClick={() => approve.mutate({ id })}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Approve
        </Button>
      </div>
      {error ? <span className="text-xs text-crit">{error}</span> : null}
    </div>
  );
}

/* Copy for the verb a request will perform, so the desk is signing off on a
   described action rather than a category name. */
const REQUEST_COPY: Record<string, string> = {
  assign: "give this tool to someone",
  transfer: "move this tool to someone else",
  return: "return this tool to the yard",
  repair: "send this tool for repair",
  lost: "mark this tool missing",
  intake: "add this tool to the register",
  request_purchase: "raise a purchase request",
  report: "record this note",
};

/*
  A request raised from the field.

  These arrive from someone who described a real thing but does not hold the
  permission it costs — a foreman reporting a broken tool. Approving replays
  the exact action they described; the permission is charged to whoever presses
  the button, which is what makes this a gate rather than a loophole.
*/
function RequestControls({
  task,
  onDone,
}: {
  task: { id: string; actionType: string | null };
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const settled = () => {
    setError(null);
    onDone();
  };
  const failed = (e: unknown) => setError(e instanceof Error ? e.message : "That did not go through.");

  const approve = trpc.task.approve.useMutation({ onSuccess: settled, onError: failed });
  const decline = trpc.task.decline.useMutation({ onSuccess: settled, onError: failed });
  const busy = approve.isPending || decline.isPending;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            const reason = window.prompt("Why is this not approved?");
            if (!reason) return;
            decline.mutate({ id: task.id, reason });
          }}
        >
          Decline
        </Button>
        <Button size="sm" disabled={busy} onClick={() => approve.mutate({ id: task.id })}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Approve
        </Button>
      </div>
      {error ? <span className="max-w-[40ch] text-right text-xs text-crit">{error}</span> : null}
    </div>
  );
}
