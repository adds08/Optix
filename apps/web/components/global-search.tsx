"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, HardHat, MapPin, Radio, Search, Users } from "lucide-react";
import { Popover as Primitive } from "radix-ui";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/*
  Global search (docs/20, A1).

  One input, every entity the yard talks about. This is the same
  `entity.search` the @-mention picker uses — the resolver was built once and
  the top bar now gets the same ranked list — so there is no second search
  implementation to drift. "/" focuses it from anywhere on the desk.

  Result rows carry the kind icon so "was that a tool or a truck" is answered
  by the row itself.
*/

const KIND_ICON = {
  asset: Boxes,
  employee: Users,
  project: HardHat,
  location: MapPin,
  vehicle: Radio,
} as const;

const KIND_PATH: Record<string, (id: string) => string> = {
  asset: (id) => `/tools/${id}`,
  employee: (id) => `/people/${id}`,
  project: (id) => `/projects/${id}`,
  location: () => `/locations`,
  vehicle: () => `/locations`,
};

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /* Debounce: entity.search hits Postgres with ilikes; a keystroke per query
     is fine on the yard's fleet but pointless on a fast typer. */
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  /* "/" focuses from anywhere on the desk layout. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = trpc.entity.search.useQuery(
    { q: debounced, limit: 6 },
    { enabled: debounced.length >= 2 },
  );

  const hits = results.data ?? [];

  const go = (kind: string, id: string) => {
    const path = KIND_PATH[kind]?.(id) ?? "/home";
    setOpen(false);
    setQ("");
    setDebounced("");
    router.push(path);
  };

  return (
    <Primitive.Root open={open} onOpenChange={setOpen}>
      <Primitive.Trigger asChild>
        <button
          type="button"
          aria-label="Search the register"
          className="flex h-8 w-64 max-w-[40vw] items-center gap-2 rounded-md border border-input bg-card px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
          onClick={() => {
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
        >
          <Search className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Search tools, people, jobs…</span>
          <kbd className="label-xs hidden rounded-sm border border-border px-1.5 py-0.5 sm:inline">/</kbd>
        </button>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          align="start"
          sideOffset={6}
          className="z-[70] w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <div className="flex items-center gap-2 border-b px-2 py-1.5">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tool tag, make, name, job, truck…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Search"
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits[0]) go(hits[0].kind, hits[0].id);
              }}
            />
          </div>

          {debounced.length < 2 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              Type at least two characters — a tag, a name, a brand, a truck unit.
            </p>
          ) : results.isLoading ? (
            <div className="flex flex-col gap-1 p-1.5">
              {[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded-sm bg-muted" />)}
            </div>
          ) : !hits.length ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Nothing matches “{debounced}”.</p>
          ) : (
            <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto p-1">
              {hits.map((h) => {
                const Icon = KIND_ICON[h.kind as keyof typeof KIND_ICON] ?? Search;
                return (
                  <button
                    key={`${h.kind}:${h.id}`}
                    type="button"
                    onClick={() => go(h.kind, h.id)}
                    className="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{h.label ?? "Untagged"}</span>
                      {h.subtitle ? (
                        <span className="truncate text-xs text-muted-foreground">{h.subtitle}</span>
                      ) : null}
                    </span>
                    <span className="label-xs ml-auto shrink-0 normal-case tracking-normal text-muted-foreground/70">
                      {h.kind}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
