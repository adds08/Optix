"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OptixGlyph } from "@/components/optix-mark";
import { DUR, EASE } from "@/lib/motion";

/* Setup completion applies to every department, including people without projects. */
export function DoneStep({ firstName, onEnter }: { firstName: string; onEnter: () => void }) {
  const reduced = useReducedMotion();
  /* The tick draws itself once, then stops. A looping flourish on a screen
     somebody is about to leave is decoration that outstays the moment. */
  const [sealed, setSealed] = useState(!!reduced);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setSealed(true), 120);
    return () => clearTimeout(t);
  }, [reduced]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-10 text-center">
      <motion.div
        initial={reduced ? false : { scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE.out }}
        className="relative flex size-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10"
      >
        <OptixGlyph className="size-7 text-brand-mark" />
        <motion.span
          className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"
          initial={reduced ? false : { scale: 0 }}
          animate={{ scale: sealed ? 1 : 0 }}
          transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE.out, delay: 0.15 }}
        >
          <Check className="size-3.5" strokeWidth={3} />
        </motion.span>
      </motion.div>

      <motion.div
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE.out, delay: 0.1 }}
        className="flex max-w-md flex-col gap-2"
      >
        <h2 className="font-display text-[2rem] font-bold leading-[1.1] tracking-tight">
          {firstName ? `You're set up, ${firstName}.` : "You're set up."}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
          Your setup is saved. Your manager can maintain your projects and reporting relationships as your responsibilities change.
        </p>
      </motion.div>

      <motion.div
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE.out, delay: 0.6 }}
      >
        <Button size="lg" onClick={onEnter}>
          Take me in
          <ArrowRight className="ml-2 size-4" />
        </Button>
      </motion.div>
    </div>
  );
}
