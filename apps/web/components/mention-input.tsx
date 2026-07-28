"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, HardHat, MapPin, Truck, User } from "lucide-react";
import {
  MENTION_MIN_QUERY,
  activeMentionQuery,
  applyMention,
  type ChatMention,
  type MentionKind,
} from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/*
  A message box that types like a message box.

  The foreman writes the sentence they would have texted. `@` is the one extra
  thing to learn, and it does the obvious thing: it opens a list. There is no
  syntax to get wrong — no command to remember, no order to follow, nothing
  that fails if they type it a different way tomorrow. Sending without ever
  pressing `@` works exactly as it did before.

  What the picker buys is that the noun stops being a guess. "@10" finds
  UIC-1012 and TRU-010 and job 10021 together, they tap the one they meant, and
  the message carries that row's id. The parser then only has to work out the
  verb, which is the part it is actually good at.
*/

const KIND_ICON: Record<MentionKind, React.ComponentType<{ className?: string }>> = {
  asset: Boxes,
  employee: User,
  project: HardHat,
  location: MapPin,
  vehicle: Truck,
};

/* Plain words, not table names. A foreman reads "Tool", not "asset". */
const KIND_LABEL: Record<MentionKind, string> = {
  asset: "Tool",
  employee: "Person",
  project: "Job",
  location: "Place",
  vehicle: "Truck / trailer",
};

type Hit = {
  kind: MentionKind;
  id: string;
  label: string;
  subtitle?: string;
  locationId?: string;
};

export function MentionInput({
  value,
  onChange,
  onSubmit,
  mentions,
  onMentionsChange,
  disabled,
  placeholder = "What happened?",
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  mentions: ChatMention[];
  onMentionsChange: (m: ChatMention[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  /* Dismissing with Escape must survive re-renders, or the list reopens on the
     next keystroke while the caret is still inside the same `@word`. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  /* The labels already picked tell the parser when a mention is finished —
     without them the query keeps growing past the name and the panel never
     closes. See activeMentionQuery. */
  const appliedLabels = useMemo(() => mentions.map((m) => m.label), [mentions]);
  const active = useMemo(
    () => activeMentionQuery(value, caret, appliedLabels),
    [value, caret, appliedLabels],
  );
  const open = !!active && active.start !== dismissedAt && active.query.length >= MENTION_MIN_QUERY;

  const results = trpc.entity.search.useQuery(
    { q: active?.query ?? "", limit: 12 },
    { enabled: open, staleTime: 10_000 },
  );

  const hits: Hit[] = useMemo(() => (open ? ((results.data ?? []) as Hit[]) : []), [open, results.data]);

  useEffect(() => setHighlight(0), [active?.query]);

  function pick(hit: Hit) {
    const a = active;
    if (!a) return;
    const next = applyMention(value, a.start, caret, hit.label);
    onChange(next.text);
    onMentionsChange([
      ...mentions.filter((m) => !(m.kind === hit.kind && m.id === hit.id)),
      { kind: hit.kind, id: hit.id, label: hit.label },
    ]);
    setDismissedAt(null);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  }

  /*
    A mention only counts while its label is still in the text. Backspacing
    "@Dwayne Ellis" away has to drop the id too, or the message keeps sending a
    custodian the author no longer mentions.
  */
  useEffect(() => {
    const live = mentions.filter((m) => value.includes(m.label));
    if (live.length !== mentions.length) onMentionsChange(live);
  }, [value, mentions, onMentionsChange]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open && hits.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % hits.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + hits.length) % hits.length);
        return;
      }
      /* Enter and Tab both take the highlighted row. Enter is what a phone
         keyboard offers, Tab is what a desk user reaches for. */
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const hit = hits[highlight];
        if (hit) pick(hit);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(active?.start ?? null);
        return;
      }
    }

    /* Enter sends; Shift+Enter is a newline. The list, when open, gets Enter
       first — handled above. */
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSubmit();
    }
  }

  function sync(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    setCaret(e.currentTarget.selectionStart ?? 0);
  }

  /*
    The button does what typing `@` does.

    Nobody who has not been shown it will discover a bare keyboard shortcut,
    and the people this is for are the least likely to go looking. A visible
    control that inserts the character — with a space in front if needed, so it
    actually triggers — makes the feature findable without changing how it
    works for anyone who already types it.
  */
  function openPicker() {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const needsSpace = at > 0 && !/\s/.test(value[at - 1] ?? " ");
    const insert = needsSpace ? " @" : "@";
    const next = value.slice(0, at) + insert + value.slice(at);
    onChange(next);
    setDismissedAt(null);
    const caretAt = at + insert.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caretAt, caretAt);
      setCaret(caretAt);
    });
  }

  return (
    <div className="relative flex-1">
      {open ? (
        <div className="absolute bottom-full z-20 mb-2 w-full overflow-hidden rounded-md border bg-popover shadow-lg">
          {results.isLoading ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">Looking…</p>
          ) : !hits.length ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">
              Nothing matches &ldquo;{active?.query}&rdquo;. Keep typing the sentence — the desk
              will still get it.
            </p>
          ) : (
            <ul role="listbox" className="max-h-64 overflow-y-auto">
              {hits.map((hit, i) => {
                const Icon = KIND_ICON[hit.kind];
                return (
                  <li key={`${hit.kind}:${hit.id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === highlight}
                      /* Mouse down rather than click: click fires after blur,
                         by which point the caret position is gone. */
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(hit);
                      }}
                      onMouseEnter={() => setHighlight(i)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left",
                        i === highlight ? "bg-accent" : "bg-transparent",
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{hit.label}</span>
                        {hit.subtitle ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {hit.subtitle}
                          </span>
                        ) : null}
                      </span>
                      <span className="label-xs shrink-0">{KIND_LABEL[hit.kind]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <button
        type="button"
        onClick={openPicker}
        aria-label="Find a tool, person or job"
        title="Find a tool, person or job"
        className="absolute bottom-1 left-1 z-10 flex size-7 items-center justify-center rounded-md border bg-card text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        @
      </button>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={sync}
        onClick={sync}
        onSelect={sync}
        placeholder={placeholder}
        aria-label="Message"
        className="max-h-32 min-h-9 w-full resize-none rounded-lg border border-input bg-transparent py-1.5 pl-10 pr-3 text-sm transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </div>
  );
}

/* Shown under the box so the author can see what the sentence resolved to
   before they send it — the whole point is that these are no longer guesses. */
export function MentionChips({ mentions }: { mentions: ChatMention[] }) {
  if (!mentions.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="label-xs">Linked</span>
      {mentions.map((m) => {
        const Icon = KIND_ICON[m.kind];
        return (
          <span
            key={`${m.kind}:${m.id}`}
            className="inline-flex items-center gap-1.5 rounded-sm border bg-card px-2 py-0.5 text-xs"
          >
            <Icon className="size-3 text-muted-foreground" aria-hidden />
            {m.label}
          </span>
        );
      })}
    </div>
  );
}
