"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Loader2, Send } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader, EmptyState, ErrorNote, TableSkeleton } from "@/components/sti/page";
import { StatusPill } from "@/components/sti/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateTime } from "@/lib/format";

const EXAMPLES = [
  "gave the rotary hammer UIC-1012 to Dwayne for Trinity Bridge",
  "returning UIC-1002 to the yard",
  "UIC-1008 is broken, needs repair",
  "check the generator on Friday",
];

/*
  The capture surface. A message becomes a proposed custody action that a
  person confirms — the model never writes to the database on its own.
*/
export default function ChatPage() {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const channels = trpc.messaging.listChannels.useQuery();
  const channelId = channels.data?.[0]?.id;

  const thread = trpc.messaging.messages.useQuery(
    { channelId: channelId!, limit: 40 },
    {
      enabled: !!channelId,
      refetchInterval: (q) => {
        const items = q.state.data?.items ?? [];
        return items.some((m) => ["queued", "processing"].includes(m.processingStatus))
          ? 1500
          : false;
      },
    },
  );

  const send = trpc.messaging.send.useMutation({
    onSuccess: () => {
      setDraft("");
      if (channelId) utils.messaging.messages.invalidate({ channelId, limit: 40 });
    },
  });

  const confirm = trpc.messaging.confirmAction.useMutation({
    onSuccess: () => {
      if (channelId) utils.messaging.messages.invalidate({ channelId, limit: 40 });
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
    },
  });

  const messages = [...(thread.data?.items ?? [])].reverse();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !channelId) return;
    send.mutate({ channelId, body: draft.trim() });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Field capture"
        title={channels.data?.[0]?.name ?? "Equipment channel"}
        description="Type what happened in plain language. It becomes a custody action you confirm — nothing is written until you do."
      />

      {channels.isLoading ? (
        <TableSkeleton rows={4} cols={2} />
      ) : channels.isError || !channelId ? (
        <ErrorNote message="No equipment channel exists yet. Seed the database or create one before using chat." />
      ) : (
        <>
          <div className="flex min-h-[45vh] flex-col gap-4 rounded-md border bg-card p-5">
            {!messages.length ? (
              <EmptyState
                title="No messages yet"
                description="Send the kind of sentence you would have put in a group chat."
              />
            ) : (
              messages.map((m) => (
                <Message
                  key={m.id}
                  m={m}
                  onConfirm={() => confirm.mutate({ messageId: m.id })}
                  confirming={confirm.isPending}
                />
              ))
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={submit} className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What happened?"
              aria-label="Message"
              className="flex-1"
            />
            <Button type="submit" disabled={!draft.trim() || send.isPending}>
              <Send className="size-4" />
              Send
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <span className="label-xs">Try</span>
            {EXAMPLES.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setDraft(x)}
                className="rounded-sm border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {x}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type Msg = {
  id: string;
  body: string;
  processingStatus: string;
  intentType: string | null;
  proposedAction: unknown;
  intentPayload: unknown;
  createdAt: Date | string;
};

const ACTION_COPY: Record<string, string> = {
  assign: "Give this tool to someone",
  transfer: "Move this tool to someone else",
  return: "Return this tool to the yard",
  lost: "Mark this tool missing",
  repair: "Send this tool for repair",
};

function Message({
  m,
  onConfirm,
  confirming,
}: {
  m: Msg;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const action = (m.proposedAction ?? null) as { type?: string; assetIds?: string[]; department?: string } | null;
  const payload = (m.intentPayload ?? null) as { replyText?: string; confidence?: number } | null;
  const working = ["queued", "processing"].includes(m.processingStatus);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-[70ch] rounded-md bg-muted px-3 py-2 text-sm">{m.body}</p>
        <span className="shrink-0 pt-2 text-xs text-muted-foreground">{dateTime(m.createdAt)}</span>
      </div>

      {working ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Reading that…
        </span>
      ) : null}

      {m.processingStatus === "action_proposed" && action ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/50 bg-accent/40 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="label-xs text-primary">Confirm this</span>
            <span className="text-sm font-medium">
              {ACTION_COPY[action.type ?? ""] ?? "Record this"}
              {action.assetIds?.length
                ? ` · ${action.assetIds.length} tool${action.assetIds.length === 1 ? "" : "s"}`
                : ""}
              {action.department ? ` · ${action.department}` : ""}
            </span>
            {typeof payload?.confidence === "number" ? (
              <span className="text-xs text-muted-foreground">
                model confidence {Math.round(payload.confidence * 100)}%
              </span>
            ) : null}
          </div>
          <Button size="sm" onClick={onConfirm} disabled={confirming}>
            {confirming ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Confirm
          </Button>
        </div>
      ) : null}

      {m.processingStatus === "action_executed" ? (
        <span className="flex items-center gap-1.5 text-xs text-ok">
          <Check className="size-3.5" />
          Recorded{m.intentType ? ` · ${m.intentType}` : ""}
        </span>
      ) : null}

      {m.processingStatus === "pending_manual" ? (
        <div className="flex items-center gap-2 rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-xs text-warn">
          <CircleAlert className="size-3.5 shrink-0" />
          Could not match this to a tool. It is queued for the desk in the Inbox.
        </div>
      ) : null}

      {m.processingStatus === "error" ? (
        <div className="flex items-center gap-2 rounded-md border border-crit/40 bg-crit-bg px-3 py-2 text-xs text-crit">
          <CircleAlert className="size-3.5 shrink-0" />
          This message could not be processed.
        </div>
      ) : null}

      {payload?.replyText && m.processingStatus === "action_executed" ? (
        <p className="text-xs text-muted-foreground">{payload.replyText}</p>
      ) : null}

      {m.processingStatus === "pending_manual" ? <StatusPill status="pending_manual" /> : null}
    </div>
  );
}
