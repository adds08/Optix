"use client";

import { cn } from "@/lib/utils";

/*
  Filter chip / tab — toggleable, with an optional dot and a mono count badge.
  Used for the filter/tab rows on the data surfaces. Interactive, so it is a
  <button>; the dot and count are decorative and labelled by the chip's text.
*/

export function Chip({
  active = false,
  count,
  dot = false,
  dotColor = "bg-primary",
  onClick,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  count?: string | number;
  dot?: boolean;
  dotColor?: string;
}) {
  return (
    <button
      type="button"
      data-active={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-[27px] items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] transition-colors select-none whitespace-nowrap",
        active
          ? "border-input bg-secondary font-semibold text-foreground"
          : "border-transparent bg-transparent font-medium text-muted-foreground hover:bg-accent",
        className,
      )}
      {...props}
    >
      {dot ? (
        <span className={cn("size-[7px] shrink-0 rounded-[2px]", dotColor)} aria-hidden />
      ) : null}
      {children}
      {count != null ? (
        <span
          className={cn(
            "tag-num rounded-[3px] px-1 py-px text-[10px]",
            active ? "bg-foreground/10 text-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
