"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Loader2, Send, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { relative } from "@/lib/format";

/*
  The assistant panel (System Shell v3).

  A 400px column that slides in over the right edge of the shell and stays
  there while you work — the point of putting it in the frame rather than on a
  page is that you can ask about the row you are looking at without leaving it.

  It is the SAME capture surface as /chat, not a second one. Sending goes
  through `messaging.send`, the worker parses it, and nothing is written to the
  ledger until a person presses Confirm — the model never commits a custody
  move on its own (ADR-4). The shell's design showed an assistant that answers
  from a canned script; wiring that to a fake would put a component in the
  product that lies about what the backend does, so the panel answers with the
  real message lifecycle instead.

  What the panel deliberately does NOT carry, compared with /chat: mentions,
  the drafted-fields table for a registration, and the day dividers. Those need
  width. The panel is for "give the hammer to Barnes" and "did that land"; the
  page is for reading back a week.
*/

const POLL_FAST = 1500;
const POLL_SLOW = 8000;

export function AiPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  /* Every query in here is gated on `open`: a panel nobody has opened must not
     be polling the thread every 1.5 seconds behind the page. */
  const channels = trpc.messaging.listChannels.useQuery(undefined, { enabled: open });
  const channelId = activeId ?? channels.data?.[0]?.id;

  const thread = trpc.messaging.messages.useQuery(
    { channelId: channelId!, limit: 30 },
    {
      enabled: open && !!channelId,
      refetchInterval: (q) => {
        const items = q.state.data?.items ?? [];
        return items.some((m) => ["queued", "processing"].includes(m.processingStatus))
          ? POLL_FAST
          : POLL_SLOW;
      },
    },
  );

  const send = trpc.messaging.send.useMutation({
    onSuccess: () => {
      setDraft("");
      if (channelId) utils.messaging.messages.invalidate({ channelId, limit: 30 });
    },
  });

  const confirm = trpc.messaging.confirmAction.useMutation({
    onSuccess: () => {
      if (channelId) utils.messaging.messages.invalidate({ channelId, limit: 30 });
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
    },
  });

  /* Newest first from the API; render oldest first. */
  const messages = [...(thread.data?.items ?? [])].reverse();

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, open]);

  if (!open) return null;

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!draft.trim() || !channelId || send.isPending) return;
    send.mutate({ channelId, body: draft.trim() });
  }

  return (
    <aside
      /* Absolute inside the shell, not fixed: it must stop at the top bar and
         the shell's own edges, and it must not sit over a dialog's scrim. */
      className="absolute inset-y-0 right-0 z-30 flex w-100 max-w-full flex-col border-l bg-card shadow-[-4px_0_16px_rgba(0,0,0,.2)] duration-200 animate-in slide-in-from-right"
      aria-label="Assistant"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <span className="text-[13.5px] font-bold">Assistant</span>
        <button
          type="button"
          onClick={() => setShowSessions((v) => !v)}
          className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Channels
          <ChevronDown className={cn("size-3 transition-transform", showSessions && "rotate-180")} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the assistant"
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      {showSessions ? (
        <div className="sti-scroll max-h-50 shrink-0 border-b p-1.5">
          {channels.data?.map((c) => {
            const active = c.id === channelId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setActiveId(c.id);
                  setShowSessions(false);
                }}
                aria-pressed={active}
                className={cn(
                  "flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                  active
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="min-w-0 truncate">{c.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="sti-scroll flex min-h-0 flex-1 flex-col gap-3 p-4">
        {channels.isLoading ? (
          <p className="text-[13px] text-muted-foreground">Loading channels…</p>
        ) : !channelId ? (
          <p className="text-[13px] text-muted-foreground">
            No equipment channel exists yet. Seed the database or create one before using chat.
          </p>
        ) : !messages.length ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Say what happened the way you would in a group chat — &ldquo;gave the rotary hammer
            UIC-1012 to Dwayne for Trinity Bridge&rdquo;. Nothing is recorded until you confirm it.
          </p>
        ) : (
          messages.map((m) => <PanelMessage key={m.id} m={m} onConfirm={() => confirm.mutate({ messageId: m.id })} confirming={confirm.isPending} />)
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="shrink-0 border-t p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          disabled={!channelId || send.isPending}
          placeholder="Ask about tools, people, jobs…"
          className="w-full resize-none rounded-md border bg-background px-3 py-2 text-[13px] outline-none focus-visible:border-ring"
        />
        <Button type="submit" size="sm" className="mt-2 w-full" disabled={!draft.trim() || !channelId || send.isPending}>
          {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Send
        </Button>
      </form>
    </aside>
  );
}

type PanelMsg = {
  id: string;
  body: string;
  processingStatus: string;
  intentType: string | null;
  proposedAction: unknown;
  createdAt: Date | string;
  card: { tools: { id: string; tag: string | null; modelName: string | null }[]; toName: string | null } | null;
};

/* The same lifecycle vocabulary as /chat, in one line each — a message has to
   answer "what happened to it" without the reader opening anything. */
const STATUS_LINE: Record<string, { label: string; tone: "working" | "ready" | "ok" | "warn" | "crit" }> = {
  queued: { label: "Queued", tone: "working" },
  processing: { label: "Reading that…", tone: "working" },
  action_proposed: { label: "Ready to confirm", tone: "ready" },
  action_executed: { label: "Recorded", tone: "ok" },
  action_requested: { label: "Sent to the desk", tone: "warn" },
  pending_manual: { label: "Needs the desk", tone: "warn" },
  error: { label: "Could not be processed", tone: "crit" },
};

function PanelMessage({
  m,
  onConfirm,
  confirming,
}: {
  m: PanelMsg;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const line = STATUS_LINE[m.processingStatus] ?? { label: m.processingStatus, tone: "working" as const };
  const proposed = m.processingStatus === "action_proposed" && !!m.proposedAction;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <p className="max-w-[85%] rounded-md bg-accent px-3 py-2 text-[13px] leading-relaxed text-accent-foreground">
        {m.body}
      </p>
      <span
        className={cn(
          "flex items-center gap-1.5 text-[11px]",
          line.tone === "working" && "text-muted-foreground",
          line.tone === "ready" && "text-primary",
          line.tone === "ok" && "text-ok",
          line.tone === "warn" && "text-warn",
          line.tone === "crit" && "text-crit",
        )}
      >
        {line.tone === "working" ? <Loader2 className="size-3 animate-spin" /> : null}
        {line.tone === "ok" ? <Check className="size-3" /> : null}
        {line.label} · {relative(m.createdAt)}
      </span>

      {m.card?.tools.length ? (
        <div className="w-full self-start rounded-md border bg-muted/40 px-3 py-2">
          <ul className="flex flex-col gap-1">
            {m.card.tools.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
                <Link href={`/tools/${t.id}`} className="tag-num text-primary hover:underline">
                  {t.tag ?? "no tag"}
                </Link>
                <span className="min-w-0 truncate text-muted-foreground">{t.modelName}</span>
              </li>
            ))}
          </ul>
          {m.card.toName ? (
            <p className="mt-1 text-[11px] text-muted-foreground">to {m.card.toName}</p>
          ) : null}
          {proposed ? (
            <Button size="sm" className="mt-2 h-7 w-full text-xs" onClick={onConfirm} disabled={confirming}>
              {confirming ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Confirm
            </Button>
          ) : null}
        </div>
      ) : proposed ? (
        <Button size="sm" className="h-7 self-start text-xs" onClick={onConfirm} disabled={confirming}>
          {confirming ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Confirm
        </Button>
      ) : null}
    </div>
  );
}
