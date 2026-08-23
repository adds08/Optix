import { cn } from "@/lib/utils";

/*
  Status pill — a compact status callout for card headers. Status hues are the
  reserved --ok/--warn/--crit set only, never decorative. The "accent" variant
  is the drafting blue (--primary), matching the design's accent/primary split.
*/

type StatusVariant = "default" | "accent" | "ok" | "warn" | "crit";

const VARIANT: Record<StatusVariant, string> = {
  default: "border-border bg-muted text-muted-foreground",
  accent: "border-primary/40 bg-primary/10 text-primary",
  ok: "border-ok/30 bg-ok-bg text-ok",
  warn: "border-warn/30 bg-warn-bg text-warn",
  crit: "border-crit/30 bg-crit-bg text-crit",
};

const DOT: Record<StatusVariant, string> = {
  default: "bg-muted-foreground",
  accent: "bg-primary",
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
};

export function StatusPill({
  variant = "default",
  dot = false,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: StatusVariant;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-0.5 text-[11px] font-semibold",
        VARIANT[variant],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span
          className={cn("size-[7px] shrink-0 rounded-[2px]", DOT[variant])}
          aria-hidden
        />
      ) : null}
      {children}
    </span>
  );
}
