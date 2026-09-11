"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { OnboardingStep } from "@stinventory/api-contracts";
import { StepRail } from "@/components/onboarding/step-rail";
import { StepShell } from "@/components/onboarding/step-shell";
import { JobsStep } from "@/components/onboarding/jobs-step";
import { DetailsStep } from "@/components/onboarding/details-step";
import { LocationStep } from "@/components/onboarding/location-step";
import { ProjectTeamsPanel } from "@/components/project-teams-panel";
import { clearSession } from "@/lib/auth";
import { InviteStep } from "@/components/onboarding/invite-step";
import { DoneStep } from "@/components/onboarding/done-step";
import { AuthSlideshow } from "@/components/auth-slideshow";
import { OptixLockup } from "@/components/optix-mark";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/sti/page";
import { DUR, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/*
  First-run setup.

  OUTSIDE the `(app)` route group, and that is the most important thing about
  this file. The first version lived under it and inherited the whole shell —
  a sidebar, a project switcher and a notification bell framing a form for
  somebody who has never seen the product. It asked them to parse the
  furniture before the question, and it offered three links out of the one
  screen that is supposed to hold them. Moving the route is what fixed it.

  It is deliberately the SAME SHAPE as the sign-in page next door: the job
  photographed on one side, the task on the other, the lockup above it. Those
  two screens are one sequence — sign in, then tell us what you run — and a
  person should not feel handed between two products halfway through. The
  photographs are the same four the timesheet product signs in on, for the
  reason `auth-slideshow.tsx` gives at length.

  What this screen does NOT do is write anything the person could not write
  themselves. Every roster write goes through `projectTeam.assign` under their
  own permissions: a superintendent puts their foremen on, and a foreman does
  not, because a foreman never could. A foreman's crew step is therefore a
  CONFIRMATION of what their superintendent already recorded, not an empty form
  they lack the rights to fill. Inventing an elevated path here would be a
  second way to write the roster, which is the pattern this codebase has paid
  for most.
*/

const STEP_LABELS: Record<string, string> = {
  review: "Review and finish",
  projects: "Your jobs",
  details: "Job details",
  location: "On the map",
  crew: "Your crew",
  invite: "Bring them in",
};

/* What each step is actually asking, in one line. Sits under the step title so
   the person is never guessing why they are being asked. */
const STEP_BLURB: Record<string, string> = {
  review: "Confirm your details. Your manager can maintain team assignments after setup.",
  projects: "What your company has you on. If something's missing, whoever runs that job adds you to it.",
  details: "Only what isn't recorded yet. A job with nothing missing won't ask.",
  location: "Drop a pin so the yard knows where this job is. Optional — skip it if you'd rather not.",
  crew: "Confirm what's already recorded, name who's missing, or leave it for whoever owns that decision.",
  invite: "Everyone you named who doesn't have an account yet.",
};

/*
  What the photograph beside each step says.

  The panel used to carry the sign-in headline on all five steps — a half-screen
  photograph making the same point about transactions while the person filled in
  a map pin. Each line here is about the step it sits beside, and the photo
  index moves with it so the picture changes at the same moment as the words.

  Copy rule: this is the panel talking about the work, NOT a second set of
  instructions. The step already says what to do, above the form; repeating it
  here in bigger type would make the person read the same sentence twice.
*/
const STEP_SLIDES: Record<string, { photo: number; title: string; body: string }> = {
  projects: {
    photo: 0,
    title: "Start with the jobs you're actually on.",
    body: "Everything Optix knows about your tools, your crew and your costs hangs off a job. These are the ones your company has you on.",
  },
  details: {
    photo: 1,
    title: "A job with gaps costs somebody a phone call.",
    body: "An address and a number nobody recorded is the thing a driver rings the office about at seven in the morning.",
  },
  location: {
    photo: 2,
    title: "The yard needs to know where to send it.",
    body: "A pin turns every hand-off on this job into a place on a map — which truck went where, and how far a tool has drifted from it.",
  },
  crew: {
    photo: 3,
    title: "Tools follow the person, not the site.",
    body: "That only works if Optix knows who is on the job. Confirm the names already recorded and add the ones missing.",
  },
  invite: {
    photo: 0,
    title: "Nobody holds a tool the system can't see.",
    body: "The people you named need accounts before anything can be signed out to them. This is the last step.",
  },
};

/*
  How wide the step is allowed to be, and it is NOT one number.

  Every step was `max-w-2xl` — 672px, a reading measure — which is right for a
  form and wrong for the two steps that are really tables of rows and a map.
  The map in particular was a 360px box inside a 672px column inside a
  half-screen panel, so most of the space the screen had went to padding around
  a control that is strictly more useful the bigger it is.

  A LIST needs width to keep a job's code, name and address on one line. A MAP
  wants everything it can get. A FORM must stay near a reading measure however
  much room is going spare, because a 900px-wide label-and-input row is harder
  to read, not easier.
*/
const STEP_WIDTH: Record<string, string> = {
  projects: "max-w-3xl",
  details: "max-w-2xl",
  location: "max-w-5xl",
  crew: "max-w-3xl",
  invite: "max-w-2xl",
};

function rise(i: number) {
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DUR.base, ease: EASE.out, delay: 0.05 + i * 0.06 },
  };
}

export default function WelcomePage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const reduced = useReducedMotion();

  const state = trpc.onboarding.state.useQuery();
  const me = trpc.identity.me.useQuery();

  useEffect(() => {
    if (me.error?.data?.code === "UNAUTHORIZED" || me.data === null) router.replace("/");
    else if (me.data?.mustChangePassword) router.replace("/account/password");
    else if (me.data && state.data?.onboardingKind === "none") router.replace("/home");
  }, [me.data, me.error, state.data?.onboardingKind, router]);

  const steps = state.data?.steps ?? ["review"];
  const [index, setIndex] = useState(0);
  const [resumed, setResumed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    if (!resumed && state.data) { setIndex(Math.max(0, state.data.steps.indexOf(state.data.currentStep))); setResumed(true); }
  }, [resumed, state.data]);
  const [direction, setDirection] = useState(1);
  const [error, setError] = useState<string | null>(null);

  /* Finishing shows the completion screen; only "Take me in" navigates. A
     five-step form that ends in a page flick gives the person no way to tell
     whether any of it saved. Skipping still leaves immediately — somebody who
     opted out has nothing to be shown a summary of. */
  const [done, setDone] = useState(false);

  const setStep = trpc.onboarding.setStep.useMutation();
  const complete = trpc.onboarding.complete.useMutation({
    onSuccess: async (_res, vars) => {
      /* Invalidate before navigating: the shell's redirect reads this query, and
         leaving with a stale `shouldPrompt` bounces the person straight back. */
      await utils.onboarding.state.invalidate();
      if (vars?.dismissed) router.replace("/home");
      else setDone(true);
    },
    onError: (e) => setError(e.message),
  });

  const go = (next: number) => {
    if (next < 0 || next >= steps.length) return;
    setDirection(next > index ? 1 : -1);
    setIndex(next);
    setStep.mutate({ step: steps[next] as OnboardingStep });
  };

  const firstName = me.data?.firstName ?? "";
  const stepKey = steps[index] ?? "projects";
  const isLast = index === steps.length - 1;

  /* `h-svh` and `overflow-hidden` on the grid, not `min-h-svh`: the page itself
     must not scroll. The header (mark, greeting, rail) and the footer (Back,
     Continue) are fixed furniture, and the STEP is the only thing that moves —
     a thirteen-job list otherwise pushes Continue below the fold, which is
     exactly what the first version of this screen did. */
  return (
    <main className="grid h-svh overflow-hidden lg:grid-cols-[1fr_1.35fr]">
      {/* The job, photographed. Narrower than the sign-in page's panel and on
          the LEFT for the same reason it is there: this screen's content is
          taller and more interactive, so the photograph is the anchor rather
          than the headline. `hidden lg:block` keeps a phone from fetching
          backgrounds it can never see. */}
      <aside className="relative hidden overflow-hidden lg:block">
        {/* Driven by the step, so the half of the screen that isn't a form
            still responds when the person moves. The completion screen drops
            back to the sign-in copy: at that point there is no step to talk
            about, and the panel returning to what it says at the front door
            closes the sequence where it started. */}
        <AuthSlideshow slide={done ? undefined : STEP_SLIDES[stepKey]} />
      </aside>

      {/* `min-h-0` is what lets the middle section actually scroll: without it a
          flex child's implicit `min-height: auto` refuses to shrink below its
          content, the column grows past the grid cell, and the footer leaves
          the viewport instead of the list scrolling. */}
      {/* The completion screen replaces the whole column — header, rail and
          footer included. Leaving a step rail and a Back button beside "You're
          set up" would invite somebody to walk back into a form they have just
          finished. */}
      {done ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between gap-4 px-6 py-6 sm:px-10">
            <OptixLockup />
          </div>
          <div className="sti-scroll flex min-h-0 flex-1 flex-col">
            <DoneStep firstName={firstName} onEnter={() => router.replace("/home")} />
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {/*
          The header CARRIES THE GREETING ON STEP ONE AND THEN GETS OUT OF THE
          WAY. It used to be 215px of a 900px viewport — lockup, greeting, a
          two-line paragraph and the rail — identical on all five steps, so by
          step five a stale "Let's get you set up, Dana" was crowding a single
          sentence of content. The greeting is a welcome; a welcome repeated
          five times is furniture.

          Animating `height: auto` rather than swapping two blocks: the
          collapse should read as the screen making room, which is only legible
          if the eye can follow it. `overflow-hidden` on the animating element
          is what stops the greeting spilling past the border while it goes.
        */}
          <motion.header
            className="overflow-hidden border-b bg-muted/30"
            initial={false}
            animate={{ height: "auto" }}
            transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE.out }}
          >
            {/* py-6 like the header above and the content below, not py-5. Four
              bands stacked with py-6 / py-5 / py-6 / py-4 read as a drifting
              rhythm rather than a scale — the eye catches the odd one out even
              when it cannot name it. One value, and the footer keeps its
              tighter py-4 because a button row genuinely is a shorter band. */}
            <div className={cn("mx-auto flex w-full flex-col gap-5 px-2 py-6 transition-[max-width] duration-300", STEP_WIDTH[stepKey] ?? "max-w-2xl")}>
              <motion.div {...rise(0)} className="flex items-center justify-between gap-4">
                {/* The tenant's mark beside the product's, the same pairing the
                login page and the app shell already use — somebody setting up
                on `urban.optixtec.com` sees their own company first. Hardcoded
                for the one tenant; see the note on the login page for what the
                real multi-tenant version needs. */}
                <div className="flex min-w-0 items-center gap-3">
                  <img src="/assets/urban_logo.svg" alt="" className="h-7 w-auto shrink-0" />
                  <span aria-hidden className="h-6 w-px shrink-0 bg-border" />
                  <OptixLockup />
                </div>
                {/*
              Dismissing is a first-class action and belongs at the top, beside
              the mark, not hidden at the end of a five-step form. The gate
              fires once either way — see the app shell — so somebody with
              nothing to add says so and is never asked again.
            */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => { clearSession(); router.replace("/"); }}
                  disabled={complete.isPending}
                >
                  Save and sign out
                </Button>
              </motion.div>

              <AnimatePresence initial={false}>
                {(
                  <motion.div
                    key="greeting"
                    initial={reduced ? false : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE.out }}
                    className="flex flex-col gap-1.5 overflow-hidden"
                  >
                    <h1 className="font-display text-[1.75rem] font-bold leading-[1.1] tracking-tight">
                      {firstName ? `Let's get you set up, ${firstName}` : "Let's get you set up"}
                    </h1>
                    <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                      A few questions about the work you run. You can leave and come back — nothing
                      here is locked in.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div {...rise(2)}>
                <StepRail
                  steps={steps.map((k) => ({ key: k, label: STEP_LABELS[k] ?? k }))}
                  activeIndex={index}
                />
              </motion.div>
            </div>
          </motion.header>

          {/*
          `justify-center` plus `my-auto` on the block is what fixed the worst
          fault on this screen: the step was top-aligned in a fixed-height
          area, so step five — one sentence — left roughly 500px of empty
          ground with the footer stranded at the bottom of it, and the screen
          read as something that had failed to load. Centred when the content
          is shorter than the area, top-aligned and scrolling when it is
          taller, with no measuring: `my-auto` cannot push a block that already
          overflows its container.

          `justify-center` is deliberately NOT used here, and the difference is
          not cosmetic. On a scroll container it centres the overflow too, so a
          block taller than the box has its top pushed above the scrollport
          with no way to scroll back up to it — step one lost its heading and
          its search field that way. `my-auto` on the child does the same
          centring when there is room and collapses to nothing when there is
          not, which is the whole trick.
        */}
          <div className="sti-scroll flex min-h-0 flex-1 flex-col px-6 py-6 sm:px-10">
            <motion.div
              {...rise(3)}
              className={cn(
                "mx-auto flex w-full flex-col gap-4 transition-[max-width] duration-300",
                STEP_WIDTH[stepKey] ?? "max-w-2xl",
              )}
            >
              {/*
              NO STEP HEADING HERE.

              The progress rail above already names the step — "Your crew" was
              rendered twice, a few centimetres apart, and the second one bought
              nothing but height on a screen that is mostly a form.

              The blurb stays: it explains what to DO, which the rail's label
              cannot. Kept at the same width as the card below it so the column
              has one left edge.
            */}
              <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                {STEP_BLURB[stepKey]}
              </p>

              {error && <ErrorNote message={error} />}

              {/* ONE level of elevation, spent here. Everything on this screen
                sat on the page background behind a hairline, so nothing was
                foreground and the step read as a wall. The card lifts the
                thing being asked about; the header and footer stay on the
                ground behind it. Not a card per row — that flattens it again.

                The MAP step gets no card and no padding: its own bordered
                container is already the surface, and wrapping it in a second
                one boxed a map inside a box and spent 40px of the width it
                most wanted on a frame nobody needed to see. */}
              <div
                className={cn(
                  stepKey !== "location" && "rounded-lg bg-card p-2 shadow-sm sm:p-4",
                )}
              >
                <StepShell stepKey={stepKey} direction={direction}>
                  {stepKey === "projects" && <JobsStep />}
                  {stepKey === "details" && <DetailsStep />}
                  {stepKey === "location" && <LocationStep />}
                  {stepKey === "crew" && <ProjectTeamsPanel onboarding />}
                  {stepKey === "invite" && <InviteStep />}
                  {stepKey === "review" && <div className="space-y-4"><h3 className="font-medium">Welcome, {firstName}</h3><p className="text-sm text-muted-foreground">{state.data?.onboardingKind === "people" ? "Your workspace is for people and employee records. Project and tool setup is not required." : state.data?.onboardingKind === "equipment" ? "Your saved projects and reporting branch are shared with your manager. Missing assignments can be completed by your manager after you finish." : "Your administrator has configured the screens and actions available to you."}</p><p className="text-sm">Imported HR details are maintained in BambooHR. Ask HR to correct your job title or department; ask your manager about project responsibilities.</p><label className="flex items-start gap-3 rounded-md border p-3 text-sm"><input className="mt-1" type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />I have reviewed my setup and understand that my manager maintains my project access after onboarding.</label></div>}
                </StepShell>
              </div>
            </motion.div>
          </div>

          <footer className="border-t px-6 py-4 sm:px-10">
            <div className={cn("mx-auto flex w-full items-center justify-between gap-3 transition-[max-width] duration-300", STEP_WIDTH[stepKey] ?? "max-w-2xl")}>
              <Button variant="ghost" size="sm" onClick={() => go(index - 1)} disabled={index === 0}>
                <ArrowLeft className="mr-1.5 size-4" />
                Back
              </Button>

              <span className="text-xs tabular-nums text-muted-foreground">
                Step {index + 1} of {steps.length}
              </span>

              {isLast ? (
                <Button size="sm" onClick={() => complete.mutate({ dismissed: false, acknowledged })} disabled={complete.isPending || !acknowledged}>
                  {complete.isPending ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Check className="mr-1.5 size-4" />
                  )}
                  Finish setup
                </Button>
              ) : (
                <Button size="sm" onClick={() => go(index + 1)}>
                  Continue
                  <ArrowRight className="ml-1.5 size-4" />
                </Button>
              )}
            </div>
          </footer>
        </div>
      )}
    </main>
  );
}
