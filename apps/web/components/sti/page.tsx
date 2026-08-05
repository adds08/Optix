"use client";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/* Page scaffolding shared by every screen, so headers and empty states
   never drift apart between pages. */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /* One-line header for pages whose context lives elsewhere (tabs, tables).
     Saves the vertical space the big title+description block takes on pages
     that do not need to announce themselves (docs/20, A3). */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
    );
  }
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow ? <span className="label-xs">{eyebrow}</span> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description ? (
          <p className="max-w-[62ch] text-sm text-muted-foreground text-pretty">{description}</p>
        ) : null}
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
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "warn" | "crit" | "ok";
  loading?: boolean;
}) {
  const accent =
    tone === "warn" ? "text-warn" : tone === "crit" ? "text-crit" : tone === "ok" ? "text-ok" : "text-foreground";
  return (
    <div className="metric-card flex flex-col gap-1 rounded-md border bg-card p-4">
      <span className="label-xs">{label}</span>
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
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed bg-card/40 px-6 py-14 text-center">
      {Icon ? <Icon className="size-6 text-muted-foreground" /> : null}
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="mx-auto max-w-[46ch] text-sm text-muted-foreground text-pretty">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
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

/* Wide content scrolls inside its own container — the page body never
   scrolls sideways — and long tables scroll vertically under a sticky
   header (see `.sti-table-scroll` in globals.css). */
export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("sti-table-scroll w-full overflow-auto rounded-md border bg-card", className)}>{children}</div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-crit/30 bg-crit-bg px-4 py-3 text-sm text-crit">
      {message}
    </div>
  );
}
