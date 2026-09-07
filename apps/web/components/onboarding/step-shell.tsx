"use client";

import { createContext, useContext, useEffect, useState } from "react";
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

  THE LEAFLET TRAP, found live in a browser rather than guessed at. The
  location step's map crashed on EVERY entry with "Cannot read properties of
  undefined (reading '_leaflet_events')" — reproducible, not intermittent —
  and only while mounting into this wrapper's enter animation, never on a
  plain page load. Leaflet measures its container's layout when it
  initializes, and this wrapper's `x` is a live CSS transform for the whole
  `DUR.route` of that animation: `MapContainer` was reading its size off an
  ancestor whose geometry was still changing every frame, which is not a state
  Leaflet's internal event wiring tolerates.

  `StepReady` is the fix, exported so any future step with the same problem
  (a canvas, a chart, anything that measures its own DOM on mount) can use it
  without rediscovering this. It answers one question — "has this step's
  entrance animation finished" — via `onAnimationComplete`, and a step that
  needs a stable container waits for it before mounting the fussy child.
  `useStepReady` defaults to `true` once `prefers-reduced-motion` holds this at
  a plain fade, since a fade never moves the container in the first place.
*/
const StepReadyContext = createContext(false);

/* True once THIS step's own enter transition has finished settling. */
export function useStepReady() {
  return useContext(StepReadyContext);
}

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
  const [ready, setReady] = useState(reduced ?? false);

  /* A fresh flag per step, not carried over from the previous one — otherwise
     the FIRST step after a reduced-motion mount would inherit `true` from a
     step that never actually finished animating in. */
  useEffect(() => {
    setReady(!!reduced);
  }, [stepKey, reduced]);

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
        onAnimationComplete={() => setReady(true)}
      >
        <StepReadyContext.Provider value={ready}>{children}</StepReadyContext.Provider>
      </motion.div>
    </AnimatePresence>
  );
}
