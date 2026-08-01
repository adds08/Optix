import { cn } from "@/lib/utils";

/*
  Asset / assignment state, rendered so it reads at a glance.
  State is encoded in SHAPE as well as color — a square marker for settled states,
  a triangle for attention, a hollow marker for inert — so the pill survives
  colorblindness, greyscale printing, and forced-colors mode. The label always ships.
*/

type Tone = "ok" | "warn" | "crit" | "idle" | "info";

const TONE: Record<Tone, string> = {
  ok: "text-ok bg-ok-bg border-ok/25",
  warn: "text-warn bg-warn-bg border-warn/25",
  crit: "text-crit bg-crit-bg border-crit/25",
  idle: "text-idle bg-idle-bg border-idle/25",
  info: "text-accent-foreground bg-accent border-primary/20",
};

const MARK: Record<Tone, string> = {
  ok: "bg-current",
  warn: "bg-current [clip-path:polygon(50%_0,100%_100%,0_100%)]",
  crit: "bg-current [clip-path:polygon(50%_0,100%_100%,0_100%)]",
  idle: "border border-current bg-transparent",
  info: "bg-current rounded-full",
};

/* Every asset status maps to exactly one tone. Unknown values fall back to idle. */
const ASSET_TONE: Record<string, Tone> = {
  available: "ok",
  assigned: "info",
  reserved: "info",
  in_transit: "info",
  received: "ok",
  requested: "idle",
  approved: "idle",
  on_order: "idle",
  in_maintenance: "warn",
  lost: "crit",
  disposed: "idle",
  /* assignment + transfer states */
  active: "ok",
  returned: "idle",
  transferred: "idle",
  overdue: "crit",
  pending_approval: "warn",
  pending_verification: "warn",
  completed: "ok",
  cancelled: "idle",
  in_progress: "info",
  /* message processing */
  queued: "idle",
  processing: "info",
  action_proposed: "warn",
  pending_manual: "warn",
  action_executed: "ok",
  error: "crit",
};

export function toneFor(status: string | null | undefined): Tone {
  if (!status) return "idle";
  return ASSET_TONE[status] ?? "idle";
}

export function humanize(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusPill({
  status,
  tone,
  label,
  className,
}: {
  status?: string | null;
  tone?: Tone;
  label?: string;
  className?: string;
}) {
  const t = tone ?? toneFor(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 py-0.5",
        "font-mono text-[0.6875rem] uppercase tracking-[0.1em]",
        TONE[t],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0", MARK[t])} />
      {label ?? humanize(status)}
    </span>
  );
}

/* A tool tag — always monospace, always the same, so the eye can lock onto it.
   An untagged tool is a normal state, not missing data — it is a tool nobody
   has put a label on yet. Rendering an empty pill would read as a bug, and
   rendering nothing would leave the row with no left-hand column at all. */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <span
      className={cn(
        "tag-num rounded-sm px-1.5 py-0.5",
        empty ? "bg-transparent text-muted-foreground italic" : "bg-muted text-foreground",
        className,
      )}
    >
      {empty ? "no tag" : children}
    </span>
  );
}
