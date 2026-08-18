import { DEFAULT_HIGH_VALUE_THRESHOLD } from "@stinventory/types";
import { daysFrom } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  Flags are the one glanceable non-status fact on a tool — the thing you want to
  see without opening it. Status already answers "where is it"; a flag answers
  "should I care about it".

  Only flags we can actually derive from asset.list are here. "Service due" is
  deliberately absent: there is no maintenance table yet (docs/archive/01-plan.md §18),
  so it would be a badge that never lights up.

  The threshold is the same constant the API uses to decide whether a custody
  hand-off needs approval, so a tool badged "High value" here is exactly the one
  that will demand a signature there.
*/

/** Days before expiry that a warranty starts reading as "ending soon". */
export const WARRANTY_SOON_DAYS = 120;

export type FlaggableAsset = {
  acquisitionCost?: string | number | null;
  warrantyExpiresOn?: string | Date | null;
};

export type AssetFlag = "high_value" | "warranty_soon" | "warranty_expired";

export function isHighValue(a: FlaggableAsset): boolean {
  const cost = a.acquisitionCost == null ? null : Number(a.acquisitionCost);
  return cost != null && !Number.isNaN(cost) && cost >= DEFAULT_HIGH_VALUE_THRESHOLD;
}

/* daysFrom is days *since* a date, so a positive number means already past. */
export function warrantyFlag(a: FlaggableAsset): "warranty_soon" | "warranty_expired" | null {
  const since = daysFrom(a.warrantyExpiresOn);
  if (since === null) return null;
  if (since > 0) return "warranty_expired";
  if (since > -WARRANTY_SOON_DAYS) return "warranty_soon";
  return null;
}

export function flagsFor(a: FlaggableAsset): AssetFlag[] {
  const out: AssetFlag[] = [];
  if (isHighValue(a)) out.push("high_value");
  const w = warrantyFlag(a);
  if (w) out.push(w);
  return out;
}

const FLAG_LABEL: Record<AssetFlag, string> = {
  high_value: "High value",
  warranty_soon: "Warranty ends soon",
  warranty_expired: "Warranty expired",
};

/* Only the genuinely time-sensitive one gets colour. An expired warranty is
   something to act on; a warranty ending in three months is something to know. */
const FLAG_STYLE: Record<AssetFlag, string> = {
  high_value: "border-border text-muted-foreground",
  warranty_soon: "border-border text-muted-foreground",
  warranty_expired: "border-crit/30 text-crit",
};

/*
  High value is deliberately not badged.

  It is a permanent attribute, not an alert, and the card and the table already
  say it twice — the marked edge and the darker price. A third signal for the
  same fact is what made a register of ordinary tools look like a list of
  problems. It stays in `flagsFor` because the facet rail still filters on it;
  it just does not need shouting on every row that has it.
*/
const BADGED: ReadonlySet<AssetFlag> = new Set(["warranty_soon", "warranty_expired"]);

export function FlagBadges({ asset, className }: { asset: FlaggableAsset; className?: string }) {
  const flags = flagsFor(asset).filter((f) => BADGED.has(f));
  if (!flags.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {flags.map((f) => (
        <span
          key={f}
          className={cn("rounded-sm border px-1.5 py-px text-[0.6875rem] leading-4", FLAG_STYLE[f])}
        >
          {FLAG_LABEL[f]}
        </span>
      ))}
    </span>
  );
}
