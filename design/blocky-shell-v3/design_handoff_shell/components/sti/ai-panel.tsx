"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

export type ChatMessage = { role: "user" | "ai"; text: string };
export type ChatSession = {
  id: string;
  title: string;
  /* Pre-formatted — "Today", "2 days ago". */
  time: string;
  messages: ChatMessage[];
};

/*
  The assistant as a right-hand sheet rather than a hand-rolled overlay.

  The HTML prototype animated its own panel and managed its own backdrop; this
  uses your Sheet primitive instead, which brings the focus trap, the Escape
  handler, scroll locking and the phone-width case with it. That is the one
  place this intentionally diverges from the mock: the mock's overlay was not
  keyboard-reachable, and shipping that would be a regression.

  Sending is a callback. The component holds only the draft and which session
  is open — the transcript is owned by the caller, so tRPC (or an optimistic
  mutation) stays outside the UI.
*/

export function AiPanel({
  open,
  onOpenChange,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onSend,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onSend: (text: string) => void;
  /* Renders the thinking row and blocks a second submit. */
  pending?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const active =
    sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;

  /* Pin to the newest message on open, on a new turn, and when switching
     sessions. `block: "nearest"` keeps the scroll inside the transcript. */
  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, active?.messages.length, activeSessionId]);

  function submit() {
    const text = draft.trim();
    if (!text || pending) return;
    onSend(text);
    setDraft("");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[400px]"
      >
        <SheetHeader className="shrink-0 flex-row items-center gap-2 border-b px-4 py-3">
          <SheetTitle className="text-[13px] font-bold">
            AI Assistant
          </SheetTitle>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-primary"
              aria-expanded={showHistory}
              onClick={() => setShowHistory((v) => !v)}
            >
              {showHistory ? "Hide history" : "History"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs font-semibold text-primary"
              onClick={onNewSession}
            >
              <Plus className="size-3" aria-hidden />
              New
            </Button>
          </div>
        </SheetHeader>

        {showHistory ? (
          <ul className="sti-scroll max-h-[200px] shrink-0 border-b p-2">
            {sessions.map((s) => {
              const current = s.id === active?.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectSession(s.id);
                      setShowHistory(false);
                    }}
                    aria-current={current}
                    className={cn(
                      "mb-0.5 w-full rounded-md px-2.5 py-2 text-left transition-colors",
                      current ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <span
                      className={cn(
                        "block truncate text-xs",
                        current
                          ? "font-semibold text-accent-foreground"
                          : "text-foreground",
                      )}
                    >
                      {s.title}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {s.time}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div
          className="sti-scroll flex min-h-0 flex-1 flex-col gap-3 p-4"
          role="log"
          aria-live="polite"
        >
          {active?.messages.length ? (
            active.messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "flex",
                  m.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <p
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-xs leading-relaxed",
                    m.role === "user"
                      ? "bg-accent text-accent-foreground"
                      : "border bg-card text-muted-foreground",
                  )}
                >
                  {m.text}
                </p>
              </div>
            ))
          ) : (
            <p className="mt-8 text-center text-xs text-muted-foreground">
              Ask about a tool tag, a person, or a job.
            </p>
          )}

          {pending ? (
            <p className="text-xs text-muted-foreground/70">Thinking…</p>
          ) : null}
          <div ref={endRef} />
        </div>

        <div className="shrink-0 border-t p-4">
          <Textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about tools, people, jobs…"
            className="resize-none text-xs"
          />
          <Button
            onClick={submit}
            disabled={!draft.trim() || pending}
            className="mt-2 w-full gap-1.5"
            size="sm"
          >
            <SendHorizontal className="size-3.5" aria-hidden />
            Send
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
