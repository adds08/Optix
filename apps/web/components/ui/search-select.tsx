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
  /* Tailwind width for the TRIGGER only, e.g. "w-48" — the filter bar wants
     buttons that keep their size as the selection changes. The panel is not
     bound to it: an option list squeezed into a 12rem button is how
     "URB-1042 · Northgate Drive Reconstruction" becomes "URB-1042 · Nor…". */
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
          title={selected ? selected.label : placeholder}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      {/* The panel sizes to its longest option, never narrower than the button
          it hangs off and never wider than the viewport can hold. */}
      <PopoverContent
        align="start"
        className="w-auto min-w-(--radix-popover-trigger-width) max-w-[min(28rem,calc(100vw-2rem))] p-0"
      >
        <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-auto border-0 p-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-72 overflow-y-auto overscroll-contain p-1">
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
                  title={o.label}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent",
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
