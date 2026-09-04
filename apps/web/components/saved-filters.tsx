"use client";

import { useEffect, useState } from "react";
import { Bookmark, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
  Saved filter presets for one page, kept in the browser under that page's key.

  "Save this view" is how a desk person stops rebuilding the same filter every
  morning — the fleet on Legacy West, the tools out with Miguel, the trailers
  that have not moved. Nothing leaves the browser, so every person gets their
  own presets and nothing needs a new table.

  The filter shape is page-specific and JSON-serialisable: each page passes its
  current state and receives a saved state back through `onApply`.
*/

type SavedFilter = { name: string; filters: Record<string, unknown> };

function load(key: string): SavedFilter[] {
  try {
    const raw = localStorage.getItem(`sti:saved-filters:${key}`);
    return raw ? (JSON.parse(raw) as SavedFilter[]) : [];
  } catch {
    return [];
  }
}

function persist(key: string, list: SavedFilter[]) {
  localStorage.setItem(`sti:saved-filters:${key}`, JSON.stringify(list));
}

export function SavedFilters({
  storageKey,
  current,
  onApply,
  hasActive,
  onClear,
}: {
  storageKey: string;
  current: Record<string, unknown>;
  onApply: (f: Record<string, unknown>) => void;
  hasActive: boolean;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<SavedFilter[]>(() => load(storageKey));

  useEffect(() => {
    setSaved(load(storageKey));
  }, [storageKey]);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = [...saved.filter((s) => s.name !== trimmed), { name: trimmed, filters: current }];
    setSaved(next);
    persist(storageKey, next);
    setName("");
  };

  const remove = (n: string) => {
    const next = saved.filter((s) => s.name !== n);
    setSaved(next);
    persist(storageKey, next);
  };

  return (
    <div className="relative">
      {/* default (34px) — matches the search field and toolbar controls beside it. */}
      <Button
        size="default"
        variant="outline"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Saved filters"
      >
        <Bookmark className="size-3.5" aria-hidden />
        Saved
        {saved.length ? <span className="tnum text-muted-foreground">({saved.length})</span> : null}
      </Button>

      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border bg-card p-2 shadow-lg">
          <div className="flex gap-1.5">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="Name this view…"
              className="h-7 text-xs"
              aria-label="Name for this filter"
            />
            <Button size="sm" variant="outline" onClick={save} disabled={!name.trim()} aria-label="Save filters">
              <Plus className="size-3.5" aria-hidden />
            </Button>
          </div>

          <div className="mt-1.5 border-t pt-1.5">
            {saved.length === 0 ? (
              <p className="px-1.5 py-1 text-xs text-muted-foreground">
                Nothing saved yet — set the filters above, then save them here.
              </p>
            ) : (
              saved.map((s) => (
                <div key={s.name} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onApply(s.filters);
                      setOpen(false);
                    }}
                    className="flex flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-accent"
                  >
                    <Bookmark className="size-3 text-muted-foreground" aria-hidden />
                    {s.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s.name)}
                    aria-label={`Delete ${s.name}`}
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              ))
            )}
            {hasActive ? (
              <button
                type="button"
                onClick={onClear}
                className="mt-1.5 flex w-full items-center gap-2 rounded border-t px-1.5 pt-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
              >
                <Check className="size-3" aria-hidden />
                Clear current filters
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
