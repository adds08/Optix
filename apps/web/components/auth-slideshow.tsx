"use client";

import { useEffect, useState } from "react";
import { OptixPlate } from "@/components/optix-mark";

/*
  The sign-in panel: the job, photographed.

  It replaced a drawn, animated diagram of a resource moving between two jobs
  on 2026-09-01 — a route with a token riding it, a strip of line-art
  resources, a ledger writing itself and a scanner sweeping the whole thing.
  Every piece of it was deliberate and together they were too much: four
  independent loops running forever beside a form whose entire job is to take
  two fields and get out of the way. The old panel is in git if the argument
  for it ever comes back; `auth-panel.tsx`, removed in the same change.

  These are the same four photographs the timesheet product signs in on
  (`timesheet/public_html/img/loginpage`) — real Urban jobsites, already duotoned
  to the navy the mark sits on. Matching it is the point: the two products are
  being sold as one platform and their front doors should not look like they
  came from different companies.

  **Backgrounds, not <img>.** The panel is `hidden lg:block`, and a display:none
  element does not fetch a background — so a phone opening the sign-in page
  downloads none of these, where four stacked <img> tags would have cost it
  780KB it can never see. That is the whole reason for the shape of this file.
*/

const PHOTOS = ["/login/1.jpg", "/login/2.jpg", "/login/3.jpg", "/login/4.jpg"];

/* Long enough to look at a photograph rather than watch a slideshow. */
const HOLD_MS = 7000;

/*
  Optional, and the default is exactly what sign-in has always done.

  The wizard next door reuses this panel, and reusing it unchanged meant the
  same sentence about transactions sat beside all five steps while the form
  advanced — a panel that visibly ignores what the person is doing, which made
  the whole screen feel static. Passing `slide` hands the panel to the caller:
  the photograph stops rotating on its own timer and the copy follows the step.

  Sign-in passes nothing and keeps the rotation and the headline it has now, so
  this is additive. `caption` without `photo` is legal — the copy changes while
  the pictures keep cycling — but the wizard sets both, because a photograph
  that changes at the same moment as the words is the thing that reads as
  responding rather than drifting.
*/
export type AuthSlide = {
  /* Index into PHOTOS. Out-of-range wraps, so a caller cannot blank the panel. */
  photo?: number;
  title: string;
  body: string;
};

export function AuthSlideshow({ slide }: { slide?: AuthSlide } = {}) {
  const [index, setIndex] = useState(0);
  /* The first photograph renders on the server; the rest mount after
     hydration, so the sign-in form is never behind three image requests it
     does not need to paint. */
  const [rest, setRest] = useState(false);

  /* A caller driving the panel owns which photograph is up, so the timer must
     not also be moving it — two things changing the same index would make the
     picture jump mid-step for no reason the person can see. */
  const driven = !!slide;

  useEffect(() => {
    /* A still panel is the correct panel for somebody who asked for less
       motion — the photograph is the content, the rotation is the decoration.
       Nothing else here depends on the timer, so returning early leaves the
       first frame on screen. */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    /* Still load the other three: a driven panel changes photograph on a step
       change, and fetching then would show a blank while it arrives. */
    setRest(true);
    if (driven) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % PHOTOS.length),
      HOLD_MS,
    );
    return () => clearInterval(timer);
  }, [driven]);

  /* Modulo rather than a clamp so a caller with more steps than photographs
     cycles instead of parking on the last one. */
  const active =
    slide?.photo === undefined
      ? index
      : ((slide.photo % PHOTOS.length) + PHOTOS.length) % PHOTOS.length;

  return (
    <div className="relative h-full overflow-hidden bg-brand-navy">
      {PHOTOS.map((src, i) =>
        i === 0 || rest ? (
          <div
            key={src}
            aria-hidden
            className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000 ease-in-out"
            style={{ backgroundImage: `url(${src})`, opacity: i === active ? 1 : 0 }}
          />
        ) : null,
      )}

      {/* The photographs are already dark, but they are photographs: the scrim
          is what makes the copy legible on all four rather than on three. It is
          weighted to the bottom, where the copy is — a flat wash over the whole
          panel would take the picture with it. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-brand-navy via-brand-navy/15 to-transparent"
      />

      <div className="relative flex h-full flex-col justify-between p-10">
        {/* `self-start`, or the flex column stretches the SVG to the panel
            width and the logo lands in the middle of the sky. */}
        <OptixPlate className="h-12 self-start" />

        <div className="flex flex-col gap-5">
          {/* The best copy in the product, carried over from the panel this
              replaced. It says the one thing that makes this different from a
              spreadsheet, and it says it without naming a screen. A driven
              panel swaps it for copy about the step, and the `key` is what
              makes that a cross-fade rather than a text substitution. */}
          <div key={slide?.title ?? "default"} className="flex flex-col gap-5 sti-fade-in">
            <p className="max-w-[18ch] text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-white">
              {slide?.title ?? "Every move on every job is a transaction, not a memory."}
            </p>
            <p className="max-w-[46ch] text-pretty text-sm leading-relaxed text-white/70">
              {slide?.body ??
                "Where every crew, machine and tool is — and which job is paying for it — is derived from that log, never typed into a field somebody can overwrite."}
            </p>
          </div>

          {/* Indicators, not controls. Four tab stops in front of the email
              field would be a real cost for a choice nobody signing in wants
              to make; the active dot is the timesheet's yellow, which is this
              product's yellow. Hidden when driven: they would be counting
              photographs while the form counts steps, and two progress-looking
              things disagreeing is worse than one of them missing. */}
          {!driven && (
            <div aria-hidden className="flex items-center gap-2 pt-1">
              {PHOTOS.map((src, i) => (
                <span
                  key={src}
                  className={
                    i === active
                      ? "h-1.5 w-6 rounded-full bg-brand-yellow transition-all duration-500"
                      : "h-1.5 w-1.5 rounded-full bg-white/35 transition-all duration-500"
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
