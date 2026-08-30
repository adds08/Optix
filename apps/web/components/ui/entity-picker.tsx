"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/*
  One way to pick an entity, everywhere.

  Before this there were four: SearchSelect (a hand-rolled Popover with its own
  filter), two Dialogs with their own lists, a plain DropdownMenu on the
  jobsite team strip, and raw <select> elements in the assign and departure
  forms. Four keyboard behaviours, four empty states, and one of them — the
  team strip — could not be searched at all, which is how "+ SUP" ended up
  offering eight rows several of which read identically.

  `hint` is not decoration. People in this register frequently share a display
  name and often have no external id, so a label alone cannot identify a row.
  Callers pass whatever distinguishes them — department, current job, unit
  number — and it is searched along with the label.
*/

export type EntityOption = {
  value: string;
  label: string;
  /* The distinguishing detail. Searched, not just displayed. */
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
};

export function EntityPicker({
  options,
  onSelect,
  value,
  placeholder = "Search…",
  empty = "Nothing matches.",
  trigger,
  align = "start",
  contentClassName,
  open: openProp,
  onOpenChange,
}: {
  options: EntityOption[];
  onSelect: (value: string) => void;
  /* Optional: renders a tick beside the current choice. Omit for "add"
     pickers, which have no current choice to mark. */
  value?: string;
  placeholder?: string;
  empty?: string;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  /* Optional controlled open, for triggers that need to report their own
     aria-expanded. Uncontrolled by default — most callers should not care. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = openProp ?? uncontrolled;
  const setOpen = (v: boolean) => {
    setUncontrolled(v);
    onOpenChange?.(v);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className={cn("w-72 p-0", contentClassName)}>
        <Command
          /* Search the hint too — a list of identical names is unfilterable
             otherwise, which was the original defect. */
          filter={(itemValue, search) => {
            const o = options.find((x) => x.value === itemValue);
            const hay = `${o?.label ?? ""} ${o?.hint ?? ""}`.toLowerCase();
            return hay.includes(search.trim().toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>{empty}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const Icon = o.icon;
                return (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    disabled={o.disabled}
                    onSelect={() => {
                      setOpen(false);
                      onSelect(o.value);
                    }}
                  >
                    {Icon ? <Icon className="size-4 shrink-0" /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.hint ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {o.hint}
                        </span>
                      ) : null}
                    </span>
                    {value === o.value ? <Check className="size-4 shrink-0" /> : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/*
  A full-width form field backed by the same picker.

  This exists so a form field and an inline "+ SUP" chip cannot drift apart:
  they are the same list, the same filtering and the same empty state, differing
  only in what you click to open them. It replaces the raw <select> elements in
  the assign and departure forms, where a native dropdown was being asked to
  hold several hundred tools with no way to type at it.
*/
export function EntityField({
  options,
  value,
  onChange,
  placeholder,
  emptyLabel,
  searchPlaceholder,
  id,
}: {
  options: EntityOption[];
  value: string;
  onChange: (v: string) => void;
  /* Shown when nothing is chosen — usually the "any / default" wording, which
     is meaningful in these forms rather than a prompt. */
  placeholder: string;
  emptyLabel?: string;
  searchPlaceholder?: string;
  id?: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <EntityPicker
      options={options}
      value={value}
      placeholder={searchPlaceholder ?? "Search…"}
      empty={emptyLabel ?? "Nothing matches."}
      contentClassName="w-(--radix-popover-trigger-width) min-w-72"
      trigger={
        <button
          type="button"
          id={id}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 py-1 text-left text-sm",
            "transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          )}
        >
          <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </button>
      }
      onSelect={onChange}
    />
  );
}

export { ChevronsUpDown };
