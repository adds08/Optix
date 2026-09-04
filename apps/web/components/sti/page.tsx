"use client";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { GridPanel } from "@/components/sti/construction";

/* Page scaffolding shared by every screen, so headers and empty states
   never drift apart between pages. */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  icon: Icon,
  compact = false,
  hideTitle = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /* Names the subject of the page — the tool's category, the report's shape.
     Decorative by construction: the title beside it already says the same
     thing, so it is hidden from assistive tech rather than labelled. Ignored
     entirely when `hideTitle` is set — there is no title beside it any more. */
  icon?: React.ComponentType<{ className?: string }>;
  /* One-line header for pages whose context lives elsewhere (tabs, tables).
     Saves the vertical space the big title+description block takes on pages
     that do not need to announce themselves (docs/20, A3). */
  compact?: boolean;
  /*
    Drops the icon box and the big `<h1>`, keeping `description` and
    `actions` exactly where they were. `title` stays REQUIRED regardless —
    every caller still names the page in code, for the same reason `alt` text
    is not optional just because a decorative image usually renders fine
    without one — but it renders nowhere.

    Added 2026-09-03, reported directly: the shell's top bar
    (`app-shell.tsx`) already renders the active nav item's label for every
    route but `/home`, so the big icon+title here was a second "Projects" or
    "People" a few pixels under the first one. `compact` does not fit this
    case — it has no `description` slot at all, and these pages' description
    sentences and action buttons (Add, Export) are the reason `PageHeader`
    is here, not decoration to cut along with the title. `org-chart` and
    `settings/team-roles` had neither and dropped `PageHeader` entirely
    instead; reach for that first if a page has nothing else this component
    is doing for it.
  */
  hideTitle?: boolean;
}) {
  if (compact) {
    return (
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
          {title}
        </h1>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
    );
  }
  /* `hideTitle` drops the icon box and the big h1. If a page also has no
     description, no actions and no eyebrow, there is nothing left to render —
     but the header still drew its `border-b pb-5` band (a gap around a line
     floating above the content). Render nothing instead, so a title-less page
     does not inherit an invisible frame. */
  if (hideTitle && !description && !actions && !eyebrow) return null;
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && !hideTitle ? (
          <span
            aria-hidden
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-accent text-accent-foreground"
          >
            <Icon className="size-[1.125rem]" />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1.5">
          {eyebrow ? <span className="label-xs">{eyebrow}</span> : null}
          {hideTitle ? null : (
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          )}
          {description ? (
            <p className="max-w-[62ch] text-sm text-muted-foreground text-pretty">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* Summary before detail: the number a person came to the page for. */
export function Metric({
  label,
  value,
  hint,
  tone,
  loading,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "warn" | "crit" | "ok";
  loading?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const accent =
    tone === "warn" ? "text-warn" : tone === "crit" ? "text-crit" : tone === "ok" ? "text-ok" : "text-foreground";
  /* The rail is the whole reason a wall of these is scannable: a grid of
     fourteen identical white boxes has no entry point, and tone here is
     already a status word (warn/crit/ok), not decoration. A card with nothing
     wrong gets no rail at all, so the coloured ones are the exception. */
  const rail =
    tone === "warn"
      ? "before:bg-warn"
      : tone === "crit"
        ? "before:bg-crit"
        : tone === "ok"
          ? "before:bg-ok"
          : "before:bg-transparent";
  return (
    <div
      className={cn(
        "metric-card relative flex flex-col gap-1 overflow-hidden rounded-md border bg-card p-4",
        "transition-colors hover:border-foreground/20",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
        rail,
      )}
    >
      <span className="flex items-center gap-1.5">
        {Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <span className="label-xs">{label}</span>
      </span>
      {loading ? (
        <Skeleton className="h-8 w-20" />
      ) : (
        <span className={cn("tnum text-3xl font-semibold tracking-tight", accent)}>{value}</span>
      )}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/* An empty state should say what to do next, not just report absence. */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    /* Grid paper, not a plain dashed panel: an empty register is a drawing
       nobody has made yet, not a page that failed to load. GridPanel owns
       the border/background/fade; the flex column here is the same layout
       the plain panel used, just one level deeper inside it. */
    <GridPanel className="px-6 py-14">
      <div className="flex flex-col items-center gap-3 text-center">
        {/* The glyph sits in a tinted disc rather than floating bare on the
            grid — a lone grey icon still reads as a page that failed to
            load even with texture behind it. */}
        {Icon ? (
          <span
            aria-hidden
            className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground"
          >
            <Icon className="size-5" />
          </span>
        ) : null}
        <div className="flex flex-col gap-1">
          <p className="font-medium">{title}</p>
          {description ? (
            <p className="mx-auto max-w-[46ch] text-sm text-muted-foreground text-pretty">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
    </GridPanel>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 bg-card px-4 py-3">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-24" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* Wide content scrolls horizontally inside its own container — the page body
   never scrolls sideways. Tables flow with the page (bounded by pagination),
   never in their own vertical scrollbox. */
export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("sti-table-scroll w-full overflow-x-auto rounded-md border bg-card", className)}>{children}</div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-crit/30 bg-crit-bg px-4 py-3 text-sm text-crit">
      {message}
    </div>
  );
}
