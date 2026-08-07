"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
  The app's dropdown, replacing native <select> everywhere.

  A native <select> renders the OS chrome (an "apple dropdown") and has no
  search — the moment a list is ten items long it is unusable. This is the
  shadcn version: a trigger that reads like the rest of the UI, and a panel
  with a live search box over the options. Search filters what is shown, never
  the selection, and clicking the already-selected option clears it — the same
  "pick nothing" escape a blank option gave a native select.
*/

export type SearchSelectOption = { value: string; label: string; hint?: string };

export function SearchSelect({
  value,
  onChange,
  placeholder,
  options,
  className,
  widthClass = "w-56",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: SearchSelectOption[];
  className?: string;
  /* Tailwind width for the trigger + panel, e.g. "w-48". */
  widthClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = options.find((o) => o.value === value);
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? options.filter(
        (o) => o.label.toLowerCase().includes(needle) || (o.hint ?? "").toLowerCase().includes(needle),
      )
    : options;

  return (
    <Popover open={open} onOpenChange={(o) => setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-8 justify-between gap-2 px-2.5 font-normal",
            value && "border-primary/40 bg-accent text-accent-foreground",
            widthClass,
            className,
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("p-0", widthClass)}>
        <div className="flex h-9 items-center gap-2 border-b px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-auto border-0 p-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">No matches for “{q}”.</p>
          ) : (
            filtered.map((o) => {
              const on = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(on ? "" : o.value);
                    setOpen(false);
                    setQ("");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                    on && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className={cn("grid size-3.5 shrink-0 place-items-center text-primary", !on && "opacity-0")}>
                    <Check className="size-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint ? <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span> : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
