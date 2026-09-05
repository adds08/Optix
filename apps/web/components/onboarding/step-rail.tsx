"use client";

import { Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { DUR, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/*
  The wizard's progress rail.

  Reads as a site plan rather than a consumer-app stepper: square nodes, a ruled
  connector, no pill shapes and no colour beyond the accent. The brief in
  `lib/motion.ts` and the palette comment is the same one — a yard tool, not a
  consumer app — so the fill TRAVELS along the connector at `DUR.base` and
  nothing pulses, bounces or overshoots.

  The connector fill is a scaleX on a child rather than an animated `width`:
  width animates layout and makes the whole row reflow on every frame, which on
  a yard laptop is visible. `transform-origin: left` is what makes it read as
  filling rather than growing from the middle.
*/
export type RailStep = { key: string; label: string };

export function StepRail({
  steps,
  activeIndex,
  furthestIndex,
  onJump,
}: {
  steps: RailStep[];
  activeIndex: number;
  /* How far they have actually been. A step ahead of this is not reachable by
     clicking — the rail shows the shape of the whole task, which is the point of
     having one, but it is not a way to skip the work. */
  furthestIndex: number;
  onJump?: (index: number) => void;
}) {
  const reduced = useReducedMotion();

  return (
    <ol className="flex items-center gap-0" role="list">
      {steps.map((s, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        const reachable = i <= furthestIndex;
        return (
          <li key={s.key} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              disabled={!reachable || !onJump}
              onClick={() => reachable && onJump?.(i)}
              className={cn(
                "group flex items-center gap-2 text-left",
                reachable && onJump ? "cursor-pointer" : "cursor-default",
              )}
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-[4px] border text-xs font-medium tabular-nums transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary bg-background text-primary ring-2 ring-primary/25",
                  !done && !active && "border-border bg-muted/40 text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  "hidden text-xs sm:inline",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </button>

            {i < steps.length - 1 && (
              <span className="mx-2 h-px flex-1 overflow-hidden bg-border" aria-hidden>
                <motion.span
                  className="block h-px w-full origin-left bg-primary"
                  initial={false}
                  animate={{ scaleX: i < activeIndex ? 1 : 0 }}
                  transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE.out }}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
