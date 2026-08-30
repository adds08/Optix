"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CircleAlert, Loader2, MessageSquare, Send } from "lucide-react";
import type { ChatMention } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNote, TableSkeleton } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { Button } from "@/components/ui/button";
import { MentionInput, MentionChips } from "@/components/mention-input";
import { dateTime, relative } from "@/lib/format";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "gave the rotary hammer UIC-1012 to Dwayne for Trinity Bridge",
  "returning UIC-1002 to the yard",
  "UIC-1008 is broken, needs repair",
  "register a DeWalt DCH273 rotary hammer, tag UIC-1099, serial 4471X",
  "check the generator on Friday",
];

/*
  The capture surface (docs/20, D).

  A message becomes a proposed custody action that a person confirms — the
  model never writes to the database on its own. The redesign is presentational
  over the same backend: two panes on a desk screen (channels + thread), the
  history grouped by day, and every message carrying a quiet status line so
  "what happened to my message" is answered by the message itself.

  Nothing here calls the LLM directly — `messaging.send` queues the message,
  the worker parses it, and this page polls at the worker's pace (fast while
  something of ours is mid-parse, slow otherwise, never off — the channel is
  shared with the field app).
*/

export default function ChatPage() {
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<ChatMention[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const channels = trpc.messaging.listChannels.useQuery();
  const channelId = activeId ?? channels.data?.[0]?.id;

  const thread = trpc.messaging.messages.useQuery(
    { channelId: channelId!, limit: 40 },
    {
      enabled: !!channelId,
      refetchInterval: (q) => {
        const items = q.state.data?.items ?? [];
        return items.some((m) => ["queued", "processing"].includes(m.processingStatus))
          ? 1500
          : 8000;
      },
    },
  );

  const send = trpc.messaging.send.useMutation({
    onSuccess: () => {
      setDraft("");
      setMentions([]);
      if (channelId) utils.messaging.messages.invalidate({ channelId, limit: 40 });
    },
  });

  /*
    STI-204: a refused confirm used to arrive as a 500 and render as nothing at
    all — the button spinner reset and the card just sat there, so "TOOL-0001
    is already in the register" was written for this screen and never shown on
    it. Same pattern as the custody queue: onError into state, ErrorNote next
    to the thing that failed. `data.userMessage` is the formatter's contract —
    non-null only when the text was written to be shown; an internal failure
    deliberately carries null and gets the generic line instead.
  */
  const [confirmError, setConfirmError] = useState<{ id: string; message: string } | null>(null);
  const confirm = trpc.messaging.confirmAction.useMutation({
    onSuccess: () => {
      setConfirmError(null);
      if (channelId) utils.messaging.messages.invalidate({ channelId, limit: 40 });
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
    },
    onError: (e, vars) =>
      setConfirmError({
        id: vars.messageId,
        message:
          e.data?.userMessage ??
          "That could not be recorded. Try again, or ask the equipment desk.",
      }),
  });

  /* Newest first from the API; render oldest first. */
  const messages = [...(thread.data?.items ?? [])].reverse();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!draft.trim() || !channelId || send.isPending) return;
    send.mutate({
      channelId,
      body: draft.trim(),
      mentions: mentions.length ? mentions : undefined,
    });
  }

  /* Group the thread by day — "Today", "Yesterday", then the date. A wall of
     identical timestamps reads as noise; a day divider reads as a record. */
  const groups = useGroups(messages);

  return (
    <div className="flex flex-col gap-4">
      {channels.isLoading ? (
        <TableSkeleton rows={4} cols={2} />
      ) : channels.isError || !channelId ? (
        <ErrorNote message="No equipment channel exists yet. Seed the database or create one before using chat." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr] lg:items-start">
          {/* ---- channels ---- */}
          <aside className="flex flex-col gap-1 overflow-hidden rounded-md border bg-card p-1.5">
            <span className="label-xs px-2 pb-1 pt-1">Channels</span>
            {channels.data?.map((c) => {
              const active = c.id === channelId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveId(c.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <MessageSquare className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                </button>
              );
            })}
          </aside>

          {/* ---- thread ---- */}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-h-[45vh] flex-col gap-4 rounded-md border bg-card p-5">
              {!messages.length ? (
                <EmptyState
                  title="No messages yet"
                  description="Send the kind of sentence you would have put in a group chat."
                />
              ) : (
                groups.map((g) => (
                  <div key={g.label} className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <span className="label-xs shrink-0">{g.label}</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    {g.items.map((m) => (
                      <Message
                        key={m.id}
                        m={m}
                        onConfirm={() => confirm.mutate({ messageId: m.id })}
                        confirming={confirm.isPending}
                        error={confirmError?.id === m.id ? confirmError.message : null}
                      />
                    ))}
                  </div>
                ))
              )}
              <div ref={endRef} />
            </div>

            <form onSubmit={submit} className="flex flex-col gap-2">
              <div className="flex items-end gap-2">
                <MentionInput
                  value={draft}
                  onChange={setDraft}
                  onSubmit={() => submit()}
                  mentions={mentions}
                  onMentionsChange={setMentions}
                  disabled={send.isPending}
                />
                <Button type="submit" disabled={!draft.trim() || send.isPending}>
                  {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Send
                </Button>
              </div>
              <MentionChips mentions={mentions} />
              <p className="text-xs text-muted-foreground">
                Write it however you would say it. Type <kbd className="rounded-sm border px-1">@</kbd>{" "}
                and part of a tag, name or project number to pick the exact one — <code>@10</code> finds
                everything with 10 in it.
              </p>
            </form>

            <div className="flex flex-wrap items-center gap-2">
              <span className="label-xs">Try</span>
              {EXAMPLES.map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => {
                    setDraft(x);
                    setMentions([]);
                  }}
                  className="rounded-sm border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function dayLabel(iso: string | Date): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function useGroups(msgs: Msg[]) {
  const out: { label: string; items: Msg[] }[] = [];
  for (const m of msgs) {
    const label = dayLabel(m.createdAt);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(m);
    else out.push({ label, items: [m] });
  }
  return out;
}

type CardTool = {
  id: string;
  tag: string | null;
  modelName: string | null;
  status: string;
  holderName: string | null;
};

type Msg = {
  id: string;
  body: string;
  processingStatus: string;
  intentType: string | null;
  proposedAction: unknown;
  intentPayload: unknown;
  createdAt: Date | string;
  card: { tools: CardTool[]; toName: string | null } | null;
};

const ACTION_COPY: Record<string, string> = {
  assign: "Give this tool to someone",
  transfer: "Move this tool to someone else",
  return: "Return this tool to the yard",
  lost: "Mark this tool missing",
  repair: "Send this tool for repair",
  intake: "Register this tool",
  request_purchase: "Ask Procurement to buy this",
};

/* The one-line fate of a message — the stepper (docs/20, D). Each state the
   worker can leave a message in has exactly one line here, so "is it done?"
   is answered in place and the card below carries the detail. */
const STATUS_LINE: Record<string, { label: string; tone: "working" | "ready" | "ok" | "warn" | "crit" }> = {
  queued: { label: "Queued — waiting for the parser", tone: "working" },
  processing: { label: "Reading that…", tone: "working" },
  action_proposed: { label: "Ready to confirm", tone: "ready" },
  action_executed: { label: "Recorded", tone: "ok" },
  action_requested: { label: "Sent to the desk as a request", tone: "warn" },
  pending_manual: { label: "Needs the desk — could not match a tool", tone: "warn" },
  error: { label: "Could not be processed", tone: "crit" },
};

/*
  The tools a message is about, named.

  This is the whole complaint: the card used to say "· 1 tool" and leave the
  reader to guess which one and where it went. Every tool gets its tag, its
  model, who is holding it now and what state it is in — so the message and the
  register agree on screen without anybody navigating away to check.

  Rendered for proposed AND settled messages alike. A card that disappears the
  moment it is confirmed cannot answer "what did I record earlier", which is
  most of why anyone scrolls back.
*/
function ToolLines({ tools, toName }: { tools: CardTool[]; toName: string | null }) {
  if (!tools.length) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {tools.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/tools/${t.id}`}>
            <Tag>{t.tag}</Tag>
          </Link>
          {t.modelName ? <span className="text-muted-foreground">{t.modelName}</span> : null}
          <StatusPill status={t.status} />
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t.holderName ?? "The yard"}
            {toName && toName !== t.holderName ? (
              <>
                <ArrowRight aria-hidden className="size-3 shrink-0 opacity-60" />
                <span className="font-medium text-foreground">{toName}</span>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

type Draft = {
  tag?: string;
  make?: string;
  modelNumber?: string;
  description?: string;
  categoryName?: string;
  serialNumber?: string;
  acquisitionCost?: string;
};

/*
  Registering a tool writes a brand new row, so the drafted fields are shown in
  full before anyone confirms. Everything the model heard is on screen — a wrong
  serial is far cheaper to catch here than after it is in the register.

  Make, model number and description render as separate rows so a wrong split
  ("DeWalt DCH273" dumped whole into one field) is visible before confirm.
*/
function DraftFields({ draft }: { draft: Draft }) {
  const fields: [string, string | undefined][] = [
    ["Tag", draft.tag],
    ["Make", draft.make],
    ["Model no.", draft.modelNumber],
    ["Description", draft.description],
    ["Code", draft.serialNumber],
    ["Category", draft.categoryName],
    ["Cost", draft.acquisitionCost],
  ];
  return (
    <dl className="mt-1 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      {fields.map(([label, value]) => (
        <div key={label} className="flex gap-1.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className={value ? "font-medium" : "text-muted-foreground"}>
            {value || "not stated"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Message({
  m,
  onConfirm,
  confirming,
  error,
}: {
  m: Msg;
  onConfirm: () => void;
  confirming: boolean;
  /* The refusal from this message's own failed confirm — guidance, not a
     crash, rendered under the card it belongs to (STI-204). */
  error: string | null;
}) {
  const action = (m.proposedAction ?? null) as {
    type?: string;
    assetIds?: string[];
    department?: string;
    draft?: Draft;
  } | null;
  const payload = (m.intentPayload ?? null) as { replyText?: string; confidence?: number } | null;
  const line = STATUS_LINE[m.processingStatus] ?? { label: m.processingStatus, tone: "working" as const };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-[70ch] rounded-md bg-muted px-3 py-2 text-sm">{m.body}</p>
        <span className="shrink-0 pt-2 text-xs text-muted-foreground" title={dateTime(m.createdAt)}>
          {relative(m.createdAt)}
        </span>
      </div>

      {/* the stepper line */}
      <span
        className={cn(
          "flex items-center gap-1.5 text-xs",
          line.tone === "working" && "text-muted-foreground",
          line.tone === "ready" && "text-primary",
          line.tone === "ok" && "text-ok",
          line.tone === "warn" && "text-warn",
          line.tone === "crit" && "text-crit",
        )}
      >
        {line.tone === "working" ? <Loader2 className="size-3 animate-spin" /> : null}
        {line.tone === "ok" ? <Check className="size-3" /> : null}
        {line.tone === "crit" ? <CircleAlert className="size-3" /> : null}
        {line.label}
      </span>

      {m.processingStatus === "action_proposed" && action ? (
        <div className="flex flex-col gap-3 rounded-md border border-primary/50 bg-accent/40 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="label-xs text-primary">Confirm this</span>
              <span className="text-sm font-medium">
                {ACTION_COPY[action.type ?? ""] ?? "Record this"}
                {action.department ? ` · ${action.department}` : ""}
              </span>
            </div>
            <Button size="sm" onClick={onConfirm} disabled={confirming}>
              {confirming ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Confirm
            </Button>
          </div>
          {m.card ? <ToolLines tools={m.card.tools} toName={m.card.toName} /> : null}
          {action.draft ? <DraftFields draft={action.draft} /> : null}
          {typeof payload?.confidence === "number" ? (
            <span className="text-xs text-muted-foreground">
              model confidence {Math.round(payload.confidence * 100)}%
            </span>
          ) : null}
          {error ? <ErrorNote message={error} /> : null}
        </div>
      ) : null}

      {/* Settled, and still a card. "Recorded · transfer" told the reader an
          event type and nothing about the tools it happened to. */}
      {m.processingStatus === "action_executed" ? (
        <div className="flex flex-col gap-2 rounded-md border border-ok/40 bg-ok-bg/40 px-4 py-3">
          <span className="flex items-center gap-1.5 text-xs text-ok">
            <Check className="size-3.5" />
            Recorded{m.intentType ? ` · ${m.intentType}` : ""}
          </span>
          {m.card ? <ToolLines tools={m.card.tools} toName={m.card.toName} /> : null}
        </div>
      ) : null}

      {payload?.replyText && m.processingStatus === "action_executed" ? (
        <p className="text-xs text-muted-foreground">{payload.replyText}</p>
      ) : null}
    </div>
  );
}
