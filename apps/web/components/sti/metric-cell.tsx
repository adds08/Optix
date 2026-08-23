import { cn } from "@/lib/utils";

/*
  Metric cell — a mono uppercase label over a value, for the horizontal metric
  bars inside job/crew cards. The value is tabular (tag-num) so a column of
  numbers lines up; `warn` colours only the value, never the cell.
*/

export function MetricCell({
  label,
  value,
  suffix,
  warn = false,
  className,
  style,
}: {
  label: string;
  value: string;
  suffix?: string;
  warn?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-between gap-2.5 px-5 py-2",
        className,
      )}
      style={style}
    >
      <span className="label-xs">{label}</span>
      <span className="flex items-baseline gap-0.5">
        <span
          className={cn(
            "tag-num text-[15px] font-semibold tracking-tight",
            warn ? "text-warn" : "text-foreground",
          )}
        >
          {value}
        </span>
        {suffix ? (
          <span className="tag-num text-[11.5px] text-muted-foreground">{suffix}</span>
        ) : null}
      </span>
    </div>
  );
}
