import { cn } from "@/lib/utils";

export type MetricTone = "default" | "warn" | "crit";

export type Metric = {
  /* Pre-formatted for display — "1,284", "$1.42M". Formatting is a server
     concern; this component does not know about locales or currency. */
  value: string;
  label: string;
  hint: string;
  tone?: MetricTone;
};

const TONE: Record<MetricTone, string> = {
  default: "text-foreground",
  warn: "text-warn",
  crit: "text-destructive",
};

/*
  Six numbers across the top of the desk. Tone colors the VALUE only — never
  the card, never the border. A wall of tinted cards reads as decoration and
  stops meaning anything; one colored number in a row of six is findable.

  <dl> rather than divs so a screen reader gets "Unaccounted, 4" instead of a
  loose "4" with the label stranded in a separate node.
*/

export function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {metrics.map((m) => (
        <div key={m.label} className="rounded-md border bg-card px-3 py-2.5">
          <dd
            className={cn(
              "tag-num text-lg font-bold leading-tight",
              TONE[m.tone ?? "default"],
            )}
          >
            {m.value}
          </dd>
          <dt className="mt-0.5 text-[10.5px] font-semibold text-muted-foreground">
            {m.label}
          </dt>
          <p className="text-[9.5px] text-muted-foreground/70">{m.hint}</p>
        </div>
      ))}
    </dl>
  );
}
