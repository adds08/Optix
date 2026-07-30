"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { MENTION_MIN_QUERY, type MentionKind } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/*
  Type-to-search for one entity, on the desk side.

  The web forms mostly use a `<select>` of every row in the tenant, which is
  fine at seed scale and unusable at four hundred tools. This is the same
  search the `@` list runs, narrowed to one kind — so the desk finds a tool the
  way the field does, by typing part of a tag.

  The value is an id or it is nothing: free text cannot be submitted, which is
  what stops a form producing the dangling references the parser can produce on
  a bad day.
*/

export type EntityValue = { id: string; label: string } | null;

const PLACEHOLDER: Record<MentionKind, string> = {
  asset: "Tag, model or serial",
  employee: "Name or employee number",
  project: "Project name or cost code",
  location: "Yard, gang box or container",
  vehicle: "Unit number or plate",
};

export function EntityField({
  label,
  kind,
  value,
  onChange,
  required,
}: {
  label: string;
  kind: MentionKind;
  value: EntityValue;
  onChange: (v: EntityValue) => void;
  required?: boolean;
}) {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);

  const open = focused && !value && q.trim().length >= MENTION_MIN_QUERY;

  const results = trpc.entity.search.useQuery(
    { q: q.trim(), limit: 8 },
    { enabled: open, staleTime: 10_000 },
  );

  /* One search across everything, filtered to the kind this field wants —
     cheaper than a per-kind endpoint and always consistent with the @ list. */
  const hits = (results.data ?? []).filter((h) => h.kind === kind);

  if (value) {
    return (
      <div className="space-y-2">
        <FieldLabel label={label} required={required} />
        <div className="flex h-8 items-center justify-between rounded-lg border border-input px-2.5 text-sm">
          <span className="truncate">{value.label}</span>
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={() => {
              onChange(null);
              setQ("");
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative space-y-2">
      <FieldLabel label={label} required={required} />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        /* Delayed so a click on a result lands before the list unmounts. */
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={PLACEHOLDER[kind]}
      />
      {open ? (
        <div className="absolute z-20 w-full overflow-hidden rounded-md border bg-popover shadow-lg">
          {results.isLoading ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Looking…</p>
          ) : !hits.length ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Nothing matches that.</p>
          ) : (
            <ul className="max-h-52 overflow-y-auto">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange({ id: h.id, label: h.label });
                      setQ("");
                    }}
                    className={cn("flex w-full flex-col px-3 py-2 text-left hover:bg-accent")}
                  >
                    <span className="text-sm font-medium">{h.label}</span>
                    {h.subtitle ? (
                      <span className="text-xs text-muted-foreground">{h.subtitle}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="text-sm font-medium">
      {label}
      {required ? <span className="text-crit"> *</span> : null}
    </label>
  );
}
