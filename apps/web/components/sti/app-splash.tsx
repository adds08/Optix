"use client";

import { AnimatePresence, motion } from "motion/react";
import { OptixWordmark } from "@/components/optix-mark";
import { DUR, EASE } from "@/lib/motion";

/*
  The boot mask.

  It exists to cover a real defect, not to look busy. `app-shell.tsx` cannot
  apply the saved appearance until `preferences.get` answers, and until this
  change it applied the DEFAULTS in the meantime — which stripped the inline
  variables the boot script in `layout.tsx` had already painted and dropped the
  `dark` class, so every reload flashed the stock light palette before snapping
  back to the user's. The shell now waits (see the `appearanceSettled` note
  there) and this covers the wait.

  Painted from `--background`, which the boot script HAS already set correctly,
  so the mask itself is the right colour on the very first frame in whichever
  palette the user chose. Anything here that hard-coded a colour would
  reintroduce the flash it is meant to hide.

  It lifts rather than cuts: 400ms of opacity, with the mark drifting up a few
  pixels behind it, so the shell appears to have been there the whole time.
*/
export function AppSplash({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="splash"
          /* `data-slot` per the house convention (see `ui/sidebar.tsx`) — it is
             how the shell's own furniture is addressed from CSS and from the
             browser suite, rather than by matching a utility class. */
          data-slot="app-splash"
          className="fixed inset-0 z-[100] grid place-items-center bg-background"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.splash, ease: EASE.out }}
          /* Decorative and transient. A screen reader should hear the shell,
             not a loading tile it can do nothing with. */
          aria-hidden
        >
          <motion.div
            className="flex flex-col items-center gap-4"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: DUR.base, ease: EASE.out }}
          >
            <OptixWordmark className="h-8 text-brand-mark" />
            {/* The same indeterminate strip `working-bar.tsx` uses, at the same
                keyframe. A boot that stalls on a slow API must not look frozen,
                and the app already has one idiom for "something is happening" —
                a second one invented here would be a second thing to maintain. */}
            <span aria-hidden className="h-0.5 w-24 overflow-hidden rounded-full bg-border">
              <span className="block h-full w-1/3 bg-primary motion-safe:animate-[sti-slide_1.1s_ease-in-out_infinite]" />
            </span>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
