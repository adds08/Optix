"use client";

import { cn } from "@/lib/utils";

/*
  The construction vocabulary, as components.

  The auth panel is drawn like a jobsite and the app behind it reads like any
  other admin console (docs/20, E). These are the pieces that carry the
  language across that seam. The CSS marks they build on live in globals.css
  under "The yard's own vocabulary".

  The rule every one of these follows: the mark has to be earned by meaning.
  Hazard striping goes on things that are genuinely blocked. A title block goes
  on a document that will be printed and filed. Grid paper goes behind emptiness
  where a drawing has not been made yet. Used anywhere else they are costume,
  and a foreman learns to ignore them — which costs more than never having
  drawn them.
*/

/*
  A banner for a state that means STOP.

  Not an error — errors are for things that failed. This is for a condition
  that blocks work and will keep blocking it until somebody acts: a tool
  written off, a person whose offboarding cannot be signed off because they
  still hold $12k of equipment.
*/
export function HazardBand({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-warn/40 bg-card", className)}>
      {/* The stripe is a 6px edge, not a fill. A full hazard fill behind text
          is unreadable and reads as a novelty; the edge is what a real barrier
          tape does — it marks the boundary, it does not cover the floor. */}
      <div className="sti-hazard h-1.5 w-full" aria-hidden />
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="label-xs text-warn">{title}</span>
          {children ? <div className="text-sm text-pretty">{children}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

/*
  A drawing title block.

  Every construction document carries one: who drew it, when, which revision,
  which sheet. Reports are this product's moat and they are printed, emailed
  and filed against jobs — a report that arrives with a title block reads as a
  document of record, and one that arrives as a bare HTML table reads as a
  screenshot. The cells are deliberately mono and uppercase: this is the one
  place in the app where matching the paperwork is the point.
*/
export function TitleBlock({
  title,
  subtitle,
  fields,
  className,
}: {
  title: string;
  subtitle?: string;
  /** Label/value pairs — JOB, DATE, REV, DRAWN BY. Four to six reads best. */
  fields: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-md border bg-card", className)}>
      <div className="flex flex-col gap-0.5 border-b px-4 py-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {/* Divided cells rather than a definition list: the grid IS the title
          block. `-mx-px` on the row lets the cell borders meet the card edge
          without doubling up. */}
      <dl className="grid grid-cols-2 divide-x divide-y sm:grid-cols-4 sm:divide-y-0">
        {fields.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-col gap-0.5 px-4 py-2.5">
            <dt className="label-xs">{f.label}</dt>
            <dd className="tnum truncate text-sm font-medium">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/*
  A stamped asset plate.

  `Tag` renders the tool's own label in mono; this is the same number treated
  as what it physically is — struck into a plate riveted to the housing. Used
  where the tag is the subject rather than one column of many: the detail page
  header, a scan confirmation, a hand-off receipt.
*/
export function Plate({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "sti-plate tag-num inline-flex items-center rounded-[3px] border px-2 py-1",
        "text-foreground tracking-[0.08em]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/*
  A ruled section divider.

  A plain 1px rule says "new section". A ruled one says the same thing in the
  yard's own handwriting, and costs a single element. `label` sits on the rule
  the way a station number sits on a survey line.
*/
export function TickRule({ label, className }: { label?: string; className?: string }) {
  if (!label) return <div className={cn("sti-tick-rule w-full", className)} aria-hidden />;
  return (
    <div className={cn("flex items-end gap-3", className)}>
      <span className="label-xs shrink-0 pb-0.5">{label}</span>
      <span className="sti-tick-rule min-w-0 flex-1" aria-hidden />
    </div>
  );
}

/*
  Grid paper behind an empty state.

  An empty register is a drawing nobody has made yet, which is a friendlier
  reading than a blank panel — and the grid gives the dashed border something
  to enclose.
*/
export function GridPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sti-grid-paper relative overflow-hidden rounded-md border border-dashed bg-card/40",
        className,
      )}
    >
      {/* The grid fades toward the middle so the content sits on clear paper
          rather than fighting a lattice behind every letter. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--card)_35%,transparent_75%)]"
      />
      <div className="relative">{children}</div>
    </div>
  );
}
