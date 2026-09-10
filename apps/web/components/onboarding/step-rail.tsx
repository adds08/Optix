"use client";

import { motion, useReducedMotion } from "motion/react";
import { DUR, EASE } from "@/lib/motion";

/*
  The wizard's progress.

  Was five numbered chips joined by rules — a lot of furniture that said very
  little, and at five steps the numbers were bigger than the labels. This is a
  single filled bar plus the current step named underneath, which is the shape
  every wizard worth copying uses: the bar answers "how much is left" at a
  glance and the label answers "what is this" without the eye leaving it.

  The bar is a scaleX on a child rather than an animated `width`: width
  animates layout and reflows the row every frame, which is visible on a yard
  laptop. `transform-origin: left` makes it read as filling rather than growing
  from the middle.

  THE DOT ROW IS GONE, and it was mine. This component carried a filled bar
  AND a five-dot stepper on the same line, three inches apart, saying the same
  thing twice — I wrote the dots as "the way back", then wrote the bar as well
  and never saw them side by side, because I checked the work by reading the
  CSS I had just typed rather than by looking at the screen. Going back is what
  the Back button in the footer is for, and the step is named right here beside
  the count. One indicator, one meaning.
*/
export type RailStep = { key: string; label: string };

export function StepRail({
  steps,
  activeIndex,
}: {
  steps: RailStep[];
  activeIndex: number;
}) {
  const reduced = useReducedMotion();
  /* Fill to the END of the current step, not its start: on step one of five a
     bar reading 0% looks like nothing has happened yet, when in fact the
     person is a fifth of the way through. */
  const pct = ((activeIndex + 1) / steps.length) * 100;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="h-1 w-full overflow-hidden rounded-full bg-border" role="presentation">
        <motion.div
          className="h-full w-full origin-left rounded-full bg-primary"
          initial={false}
          animate={{ scaleX: pct / 100 }}
          transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE.out }}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">
            {String(activeIndex + 1).padStart(2, "0")}
          </span>
          <span className="mx-1.5 opacity-40">/</span>
          <span className="font-mono tabular-nums opacity-60">
            {String(steps.length).padStart(2, "0")}
          </span>
          <span className="ml-2.5 font-medium text-foreground">{steps[activeIndex]?.label}</span>
        </p>
      </div>
    </div>
  );
}
