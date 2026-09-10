"use client";

import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityPicker } from "@/components/ui/entity-picker";
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

/*
  The filter-bar variant of the one picker.

  It used to carry its own Popover, its own <Input>, its own `includes()`
  filter and its own option buttons — a second implementation of EntityPicker
  that happened to look similar. Rebasing it means one keyboard model, one
  empty state and one filtering rule across the whole product; the four callers
  (tools page, jobsites filters, jobsite-activity, bulk-edit) keep the exact
  API they had.

  The one behaviour that is genuinely its own survives: picking the option that
  is already selected CLEARS it. These are filters, and "show me everything
  again" has to be reachable without a separate reset button — that is the
  escape a native <select>'s blank option used to give.
*/
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
  const selected = options.find((o) => o.value === value);

  return (
    <EntityPicker
      open={open}
      onOpenChange={setOpen}
      options={options}
      value={value}
      onSelect={(v) => onChange(v === value ? "" : v)}
      contentClassName="w-auto min-w-(--radix-popover-trigger-width) max-w-[min(28rem,calc(100vw-2rem))]"
      trigger={
        <Button
          variant="outline"
          size="default"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "justify-between gap-2 px-2.5 font-normal",
            value && "border-primary/40 bg-accent text-accent-foreground",
            widthClass,
            className,
          )}
          title={selected ? selected.label : placeholder}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      }
    />
  );
}
