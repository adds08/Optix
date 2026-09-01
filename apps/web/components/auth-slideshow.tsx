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

export function AuthSlideshow() {
  const [index, setIndex] = useState(0);
  /* The first photograph renders on the server; the rest mount after
     hydration, so the sign-in form is never behind three image requests it
     does not need to paint. */
  const [rest, setRest] = useState(false);

  useEffect(() => {
    /* A still panel is the correct panel for somebody who asked for less
       motion — the photograph is the content, the rotation is the decoration.
       Nothing else here depends on the timer, so returning early leaves the
       first frame on screen. */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    setRest(true);
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % PHOTOS.length),
      HOLD_MS,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative h-full overflow-hidden bg-brand-navy">
      {PHOTOS.map((src, i) =>
        i === 0 || rest ? (
          <div
            key={src}
            aria-hidden
            className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000 ease-in-out"
            style={{ backgroundImage: `url(${src})`, opacity: i === index ? 1 : 0 }}
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
              spreadsheet, and it says it without naming a screen. */}
          <p className="max-w-[18ch] text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-white">
            Every move on every job is a transaction, not a memory.
          </p>
          <p className="max-w-[46ch] text-pretty text-sm leading-relaxed text-white/70">
            Where every crew, machine and tool is — and which job is paying for it — is
            derived from that log, never typed into a field somebody can overwrite.
          </p>

          {/* Indicators, not controls. Four tab stops in front of the email
              field would be a real cost for a choice nobody signing in wants
              to make; the active dot is the timesheet's yellow, which is this
              product's yellow. */}
          <div aria-hidden className="flex items-center gap-2 pt-1">
            {PHOTOS.map((src, i) => (
              <span
                key={src}
                className={
                  i === index
                    ? "h-1.5 w-6 rounded-full bg-brand-yellow transition-all duration-500"
                    : "h-1.5 w-1.5 rounded-full bg-white/35 transition-all duration-500"
                }
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
