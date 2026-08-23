import { cn } from "@/lib/utils";

/*
  The signature Blocky card: a 3px coloured left edge bar that carries state at
  a glance across a scrolling list. The edge is a background utility class so it
  resolves through the theme tokens and follows every palette and mode:
  accent blue (primary) = normal, warn = needs attention, crit = blocked.
*/

export function EdgeCard({
  edge = "bg-primary",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { edge?: string }) {
  return (
    <div
      className={cn("flex overflow-hidden rounded-md border bg-card", className)}
      {...props}
    >
      <div className={cn("w-[3px] shrink-0 self-stretch", edge)} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
