"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/*
  Pick a category, or make one without leaving the form.

  Categories used to be whatever text somebody typed, so the only "create"
  gesture was typing a new string into a free-text box and hoping the spelling
  matched what everyone else typed. That is how a register ends up with "Power
  Tools", "Power tools" and "PowerTools" as three categories.

  This is a filtered list with the create action *inside* it, offered only when
  nothing matches what was typed. The distinction matters: the default gesture
  is picking an existing one, and creating is what you fall through to.
*/
export function CategorySelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const categories = trpc.category.list.useQuery();

  const create = trpc.category.create.useMutation({
    onSuccess: (row) => {
      setError(null);
      utils.category.list.invalidate();
      if (row?.name) onChange(row.name);
      close();
    },
    onError: (e) => setError(e.message),
  });

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const all = categories.data ?? [];
  const typed = query.trim();

  const matches = useMemo(() => {
    if (!typed) return all;
    const q = typed.toLowerCase();
    return all.filter((c) => c.name.toLowerCase().includes(q));
  }, [all, typed]);

  /* Only offer to create when the typed name is not already there — an exact
     match, case-insensitively, is a pick rather than a new thing. */
  const exact = all.some((c) => c.name.toLowerCase() === typed.toLowerCase());
  const canCreate = typed.length > 0 && !exact;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex h-8 w-full items-center justify-between rounded-lg border border-input bg-transparent px-2.5 py-1 text-left text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <span className={cn(!value && "text-muted-foreground")}>
          {value || "No category"}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <>
          {/* Click-away. Sits under the panel, over everything else. */}
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden />
          <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (matches.length === 1) {
                    onChange(matches[0]!.name);
                    close();
                  } else if (canCreate) {
                    create.mutate({ name: typed });
                  }
                }
              }}
              placeholder="Search, or type a new one"
              className="w-full border-b bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />

            <div className="max-h-56 overflow-y-auto">
              {/* Clearing is a real choice — a tool with no category is fine. */}
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  close();
                }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                No category
                {!value ? <Check className="size-3.5" /> : null}
              </button>

              {matches.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => {
                    onChange(c.name);
                    close();
                  }}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {/* An ad-hoc name that arrived by import and nobody has
                        adopted into the managed list. Worth seeing, not worth
                        blocking on. */}
                    {!c.managed ? (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        in use
                      </span>
                    ) : null}
                    <span className="text-xs tabular-nums text-muted-foreground">{c.assetCount}</span>
                    {value === c.name ? <Check className="size-3.5" /> : null}
                  </span>
                </button>
              ))}

              {!matches.length && !canCreate ? (
                <p className="px-2.5 py-3 text-sm text-muted-foreground">No categories yet.</p>
              ) : null}
            </div>

            {canCreate ? (
              <button
                type="button"
                disabled={create.isPending}
                onClick={() => create.mutate({ name: typed })}
                className="flex w-full items-center gap-2 border-t px-2.5 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-accent disabled:opacity-60"
              >
                {create.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Create &ldquo;{typed}&rdquo;
              </button>
            ) : null}

            {error ? (
              <p className="border-t bg-crit-bg px-2.5 py-2 text-xs text-crit">{error}</p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
