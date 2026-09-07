"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, HardHat, MapPin, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { OptixGlyph } from "@/components/optix-mark";
import { DUR, EASE } from "@/lib/motion";

/*
  The moment after Finish.

  The wizard used to redirect straight to `/home` the instant `complete`
  resolved, so five steps of work ended in a page flick. This holds for a beat
  and says what was actually recorded — which is also the honest answer to
  "did any of that save", a question a person has no way to check otherwise.

  Everything on it is COUNTED FROM REAL ROWS, not from what the wizard thinks
  it did. `myClaimedProjects` and `crewStatus` are the same reads steps two to
  four ran; if a write silently failed, this screen says so by showing a
  smaller number rather than congratulating somebody on work that did not
  land.

  It does not navigate on its own. An automatic redirect after a summary is a
  summary nobody reads, and this is the one screen in the flow where the person
  has nothing left to do and might want a second to look.
*/
export function DoneStep({ firstName, onEnter }: { firstName: string; onEnter: () => void }) {
  const reduced = useReducedMotion();
  const claimed = trpc.onboarding.myClaimedProjects.useQuery();
  const crew = trpc.onboarding.crewStatus.useQuery();

  const jobs = claimed.data?.length ?? 0;
  const pinned = (claimed.data ?? []).filter((p) => !p.missingLocation).length;
  const named = (crew.data ?? []).reduce(
    (n, job) => n + job.tiers.reduce((m, t) => m + t.filled.length, 0),
    0,
  );

  /* The tick draws itself once, then stops. A looping flourish on a screen
     somebody is about to leave is decoration that outstays the moment. */
  const [sealed, setSealed] = useState(!!reduced);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setSealed(true), 120);
    return () => clearTimeout(t);
  }, [reduced]);

  const stat = (icon: React.ReactNode, value: number, label: string, i: number) => (
    <motion.li
      key={label}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE.out, delay: 0.35 + i * 0.08 }}
      className="flex flex-col gap-1 rounded-md border bg-card px-4 py-3"
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-display text-2xl font-bold tabular-nums leading-none">{value}</span>
    </motion.li>
  );

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
          Optix knows what you run. From here every tool, truck and hand-off on those jobs is
          recorded against them — you will not have to tell it twice.
        </p>
      </motion.div>

      <ul className="grid w-full max-w-md grid-cols-3 gap-2.5 text-left">
        {stat(<HardHat className="size-3" aria-hidden />, jobs, "Jobs", 0)}
        {stat(<MapPin className="size-3" aria-hidden />, pinned, "On the map", 1)}
        {stat(<Users className="size-3" aria-hidden />, named, "Crew named", 2)}
      </ul>

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
