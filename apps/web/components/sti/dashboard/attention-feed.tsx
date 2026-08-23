import { cn } from "@/lib/utils";

export type FeedMark =
  | "CHECK"
  | "APPROVE"
  | "CLEAR"
  | "OVERDUE"
  | "MISSING"
  | "IDLE"
  | "NO SN";

export type FeedRow = {
  mark: FeedMark;
  /* Asset tag, or an em dash when the row is about a person or a project
     rather than one tool. */
  tag: string;
  desc: string;
  /* Pre-formatted relative age — "2h", "11d", "—". */
  age: string;
  href?: string;
};

/* Mark → tone. Three tones only: accent for "verify this", warn for "decide
   this", destructive for "this is broken". Anything that needs a fourth tone
   probably needs a different feed. */
const MARK_TONE: Record<FeedMark, string> = {
  CHECK: "text-primary border-primary/25 bg-primary/5",
  APPROVE: "text-warn border-warn/25 bg-warn-bg",
  CLEAR: "text-destructive border-destructive/25 bg-destructive/5",
  OVERDUE: "text-destructive border-destructive/25 bg-destructive/5",
  MISSING: "text-destructive border-destructive/25 bg-destructive/5",
  IDLE: "text-warn border-warn/25 bg-warn-bg",
  "NO SN": "text-warn border-warn/25 bg-warn-bg",
};

/* Spoken form for the chip, so a screen reader gets a word rather than an
   abbreviation it will spell out letter by letter. */
const MARK_LABEL: Record<FeedMark, string> = {
  CHECK: "Needs checking",
  APPROVE: "Needs approval",
  CLEAR: "Needs clearance",
  OVERDUE: "Overdue",
  MISSING: "Missing",
  IDLE: "Idle",
  "NO SN": "No serial number",
};

/* Anything measured in days is already late enough to color. */
const isAging = (age: string) => age !== "—" && age.endsWith("d");

export function AttentionFeed({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: FeedRow[];
  /* Says what the clean state MEANS, not "no data". */
  emptyText: string;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-md border bg-card">
      <h2 className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5 text-xs font-bold">
        {title}
        <span className="tag-num text-[10px] font-bold text-muted-foreground">
          {rows.length}
        </span>
      </h2>

      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <ul className="sti-scroll min-h-0 flex-1">
          {rows.map((r, i) => (
            <li key={`${r.tag}-${r.mark}-${i}`}>
              <FeedLine row={r} last={i === rows.length - 1} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedLine({ row, last }: { row: FeedRow; last: boolean }) {
  const inner = (
    <>
      <span
        aria-label={MARK_LABEL[row.mark]}
        className={cn(
          "shrink-0 rounded-sm border px-1.5 py-0.5 text-center text-[9px] font-bold uppercase tracking-wide",
          "w-14",
          MARK_TONE[row.mark],
        )}
      >
        {row.mark}
      </span>
      <span
        className={cn(
          "tag-num w-[68px] shrink-0 text-[10.5px]",
          row.tag === "—" ? "text-muted-foreground/60" : "text-muted-foreground",
        )}
      >
        {row.tag}
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-[11.5px] text-foreground">
        {row.desc}
      </span>
      <span
        className={cn(
          "shrink-0 text-[10.5px] font-semibold",
          isAging(row.age) ? "text-warn" : "text-muted-foreground/70",
        )}
      >
        {row.age}
      </span>
    </>
  );

  const shared = cn(
    "flex h-[34px] w-full items-center gap-2 px-3 transition-colors",
    !last && "border-b",
  );

  /* A row is a link when it goes somewhere and inert text when it does not —
     never a div with a click handler. */
  if (!row.href) {
    return <div className={shared}>{inner}</div>;
  }

  return (
    <a href={row.href} className={cn(shared, "hover:bg-accent")}>
      {inner}
    </a>
  );
}
