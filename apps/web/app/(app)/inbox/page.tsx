"use client";

import { CheckCircle2, Inbox as InboxIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, Metric } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { Button } from "@/components/ui/button";
import { dateTime, relative } from "@/lib/format";

/*
  The desk's work queue: messages the parser could not resolve, hand-offs
  waiting on a signature, and work items lifted out of chat. One place, so
  "is there anything for me?" is a single look.
*/
export default function InboxPage() {
  const utils = trpc.useUtils();
  const pending = trpc.messaging.pendingActions.useQuery({ limit: 50 });
  const approvals = trpc.dashboard.pendingApprovals.useQuery();
  const tasks = trpc.task.list.useQuery({ limit: 50 });

  const taskItems = Array.isArray(tasks.data) ? tasks.data : (tasks.data?.items ?? []);
  const openTasks = taskItems.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const total = (pending.data?.length ?? 0) + (approvals.data?.length ?? 0) + openTasks.length;

  const loading = pending.isLoading || approvals.isLoading || tasks.isLoading;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operations"
        title="Inbox"
        description="Everything waiting on a person at the equipment desk."
      />

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
        />
        <Metric label="Open tasks" value={openTasks.length} loading={tasks.isLoading} />
      </div>

      {loading ? (
        <TableSkeleton rows={5} cols={3} />
      ) : total === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Inbox zero"
          description="No unresolved messages, no approvals pending, no open tasks."
        />
      ) : (
        <div className="flex flex-col gap-8">
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
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-muted-foreground">
                These could not be matched to a tool automatically. Resolving them from this screen
                is not built yet — record the hand-off from Custody in the meantime.
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
                    <ApproveButton type={a.type} id={a.id} onDone={() => utils.dashboard.pendingApprovals.invalidate()} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* tasks */}
          {openTasks.length ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">
                Tasks from the field <span className="text-muted-foreground">({openTasks.length})</span>
              </h2>
              <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
                {openTasks.map((t) => (
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

function ApproveButton({ type, id, onDone }: { type: string; id: string; onDone: () => void }) {
  /* The approve endpoints live on the REST surface today; this button is a
     placeholder until they move to tRPC per ADR-2. */
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onDone}
      title="Approval from this screen is not wired yet"
      disabled
    >
      Approve
    </Button>
  );
}
