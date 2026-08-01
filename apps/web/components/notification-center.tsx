"use client";

import Link from "next/link";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { Popover as Primitive } from "radix-ui";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { relative } from "@/lib/format";

/*
  The bell. A summary of "what needs a person" plus the user's own unread
  alerts — the full work queue stays on /inbox, this is the glance.

  The badge counts exactly what the inbox counts (unread alerts + every desk
  queue), so the number cannot disagree between the two surfaces. It is polled
  at the same cadence the inbox uses; a request arriving from the field shows
  up here within fifteen seconds.
*/

const QUEUE_LABELS: { key: keyof ReturnType<typeof queuesOf>; label: string; href: string }[] = [
  { key: "overdue", label: "Overdue loans", href: "/custody" },
  { key: "approvals", label: "Approvals & hand-offs", href: "/inbox" },
  { key: "tasks", label: "Open tasks", href: "/inbox" },
  { key: "messages", label: "Unresolved messages", href: "/inbox" },
  { key: "clearance", label: "HR clearance", href: "/people" },
];

function queuesOf(n: { queues: { overdue: number; approvals: number; tasks: number; messages: number; clearance: number } }) {
  return n.queues;
}

export function NotificationCenter() {
  const utils = trpc.useUtils();
  const bell = trpc.dashboard.notifications.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => utils.dashboard.notifications.invalidate(),
  });

  const n = bell.data;
  const queues = n ? queuesOf(n) : null;
  const queueTotal = queues
    ? queues.overdue + queues.approvals + queues.tasks + queues.messages + queues.clearance
    : 0;

  return (
    <Primitive.Root>
      <Primitive.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${n?.unread ? ` (${n.unread} waiting)` : ""}`} className="relative">
          <Bell className="size-4" />
          {n && n.unread > 0 ? (
            <span className="tnum absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-crit px-1 text-[10px] font-semibold leading-4 text-white">
              {n.unread > 99 ? "99+" : n.unread}
            </span>
          ) : null}
        </Button>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[320px] overflow-hidden rounded-md border bg-popover p-0 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <span className="text-sm font-medium">Notifications</span>
            {n?.alerts.length ? (
              <button
                type="button"
                onClick={() => n.alerts.forEach((a) => markRead.mutate({ id: a.id }))}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <CheckCheck className="size-3.5" />
                Mark all read
              </button>
            ) : null}
          </div>

          {/* My unread alerts — decisions and escalations aimed at this person. */}
          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto p-1.5">
            {!n?.alerts.length ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No unread alerts for you.</p>
            ) : (
              n.alerts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => markRead.mutate({ id: a.id })}
                  className="flex flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="text-sm font-medium">{a.title}</span>
                  {a.body ? <span className="text-xs text-muted-foreground">{a.body}</span> : null}
                  <span className="text-[11px] text-muted-foreground/70">{relative(a.createdAt)}</span>
                </button>
              ))
            )}
          </div>

          {/* The desk queues, counted — the detail lives on their pages. */}
          <div className="border-t p-1.5">
            {queues ? (
              <div className="flex flex-col gap-0.5">
                {QUEUE_LABELS.map((q) => (
                  <Link
                    key={q.key}
                    href={q.href}
                    className="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  >
                    <span className="text-muted-foreground">{q.label}</span>
                    <span
                      className={cn(
                        "tnum font-medium",
                        queues[q.key] > 0 ? "text-foreground" : "text-muted-foreground/60",
                      )}
                    >
                      {queues[q.key]}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 px-2 py-2">
                {[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded-sm bg-muted" />)}
              </div>
            )}
          </div>

          <Link
            href="/inbox"
            className="flex items-center justify-center gap-1.5 border-t bg-accent/40 px-3 py-2 text-sm font-medium text-primary hover:underline"
          >
            <Inbox className="size-3.5" />
            Open the inbox
            <span className="tnum text-muted-foreground">({queueTotal})</span>
          </Link>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
