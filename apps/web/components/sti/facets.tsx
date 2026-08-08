"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/*
  Faceted filter rail.

  The rule that makes a facet list feel right: each count is computed with that
  facet's OWN filter lifted, so the number always answers "how many would I get
  if I picked this" rather than "how many are showing now". Without that, every
  count except the selected one reads 0 and the rail becomes useless the moment
  you click something.

  Counting is the caller's job (it owns the rows); this file is only the shape.
*/

export type FacetOption = {
  value: string;
  label: string;
  count: number;
};

export function FacetRail({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <aside
      className={cn("divide-y rounded-md border bg-card", className)}
      aria-label="Filters"
    >
      {children}
    </aside>
  );
}

export function FacetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1.5">
      <h3 className="label-xs px-3 pb-1 pt-1.5">{title}</h3>
      {children}
    </div>
  );
}

export function FacetRow({
  label,
  count,
  active,
  indent,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  indent?: boolean;
  onClick: () => void;
}) {
  /* A zero-count option that isn't the current selection leads nowhere, so it
     is shown (the absence is information) but not offered. */
  const dead = count === 0 && !active;
  return (
    <button
      type="button"
      onClick={dead ? undefined : onClick}
      disabled={dead}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
        indent && "pl-7",
        dead ? "cursor-default opacity-40" : "hover:bg-accent hover:text-accent-foreground",
        /* Medium, not semibold. The filled box already marks the selection —
           a weight jump on top of it makes the whole rail restless. */
        active && "font-medium",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-3 shrink-0 rounded-[3px] border",
          active ? "border-foreground bg-foreground" : "border-muted-foreground/40",
        )}
      />
      <span className="flex-1 truncate">{label}</span>
      <span className="tnum text-xs text-muted-foreground">{count}</span>
    </button>
  );
}

export function ClearFacets({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-3 py-2 text-left text-xs text-primary hover:underline"
    >
      Clear all filters
    </button>
  );
}

/* One labelled control inside a filter sheet. A bare dropdown reading "Any
   status" is fine on a bar where the neighbours give it context; stacked in a
   sheet, six of them need to say what each one is. */
export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label-xs">{label}</span>
      {children}
    </label>
  );
}

/* The chips above the results that say what is currently narrowing them. Each
   one removes exactly its own filter — the rail tells you what you *can* pick,
   these tell you what you *did*. */
export function FilterPills({
  pills,
}: {
  pills: { key: string; label: string; onRemove: () => void }[];
}) {
  if (!pills.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pills.map((p) => (
        <span
          key={p.key}
          className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pl-2.5 pr-1 text-xs"
        >
          {p.label}
          <button
            type="button"
            onClick={p.onRemove}
            aria-label={`Remove ${p.label} filter`}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-crit"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
