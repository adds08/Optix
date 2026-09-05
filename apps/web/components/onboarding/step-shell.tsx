"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DUR, EASE } from "@/lib/motion";

/*
  One step's content, and the travel between steps.

  Horizontal travel because the steps are a SEQUENCE and the rail above says so —
  a cross-fade would lose the direction, and direction is the only cue that
  going back is going back. Distance is small (24px): the brief is a yard tool,
  and a full-width slide reads as a phone app.

  Arriving uses `EASE.out` at `DUR.route`, leaving uses `EASE.in` shorter, which
  is the house rule from `lib/motion.ts` — a dismissal that lingers reads as the
  app not having heard you.

  `prefers-reduced-motion` drops travel entirely and keeps a plain fade, the same
  concession `auth-slideshow.tsx` makes. Not "no animation at all": the fade
  still says the content changed, which is the accessibility point.

  `mode="wait"` so the outgoing step is gone before the incoming one lands.
  Overlapping them makes two headings visible at once, which on a form reads as
  a glitch rather than a transition.
*/
export function StepShell({
  stepKey,
  direction,
  children,
}: {
  stepKey: string;
  /* 1 going forward, -1 going back. */
  direction: number;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const travel = reduced ? 0 : 24;

  return (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      <motion.div
        key={stepKey}
        custom={direction}
        initial={{ opacity: 0, x: direction * travel }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: direction * -travel }}
        transition={
          reduced
            ? { duration: DUR.fast }
            : { duration: DUR.route, ease: EASE.out }
        }
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
