"use client";

import { cn } from "@/lib/utils";

/*
  The Optix mark.

  This is the SUPPLIED ARTWORK, not an interpretation of it. The wordmark is
  the geometry of `logo.png` (512×143, #FFCA00) measured off its alpha channel
  and rebuilt as stroked paths: an "O" ring, then P, T, I and X drawn as the
  outlines of their own silhouettes, tightly abutting so the top and bottom
  rails read as one rule across the word. The plate is the second file, a navy
  #082F49 stadium.

  It replaced a drawn iris on 2026-09-01. The iris was a good glyph and it was
  not the company's logo, which is the only argument that matters once there
  is one.

  **The numbers below are measured, not chosen.** Every coordinate came off the
  raster, and the reconstruction was checked back against it pixel for pixel —
  hand-editing one will bend a letter and nothing will tell you. If the
  artwork is ever reissued, re-measure it; don't nudge these.

  Paths rather than an <img>: the wordmark inherits `currentColor`, so the one
  definition is the yellow logo on the sign-in photograph, the navy logo on a
  white page, and a muted-foreground logo in a footer, with no exported file
  per colour that can drift. `--brand-mark` (globals.css) is that colour
  question answered once — navy on paper, yellow on the dark surface.
*/

/* Stroke and viewBox of the wordmark, in the artwork's own units. */
const WORDMARK_VIEWBOX = "0 0 512 143";
const WORDMARK_STROKE = 9.5;

/*
  The O is very slightly wider than tall in the original (rx 53, ry 54.5); it
  is not a circle and squaring it up is visible next to the P.
*/
const O_ELLIPSE = { cx: 69, cy: 70.5, rx: 53, ry: 54.5 };

/*
  P, T, I, X as closed centre-lines. The two arcs in the P are the bowl's
  quarters — its widest point sits at y=66, below the vertical middle, which is
  why one ellipse cannot draw it and two do.
*/
const LETTERS = [
  /* P: stem, top rail, bowl, the step back in, baseline. */
  "M131.5 19.5 H185 A42.25 46.5 0 0 1 227.25 66 A46.25 37 0 0 1 181 103 V122 H131.5 Z",
  /* T: rail, right shoulder, stem, left shoulder. */
  "M227.5 19.5 H319.75 V71 H299.75 V122 H248.75 V71 H227.5 Z",
  /* I. */
  "M326.5 19.5 H380 V122 H326.5 Z",
  /* X: a hexagon pinched to two inward points that stop short of meeting.
     The gap is the letter — closing it makes a bowtie. */
  "M385.5 19.5 H491 L465 70.5 L491 121.5 H385.5 L411 70.5 Z",
];

/* The wordmark. `h-*` sizes it; the width follows the aspect ratio. */
export function OptixWordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={WORDMARK_VIEWBOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={WORDMARK_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Optix"
      className={cn("h-6 w-auto", className)}
    >
      <ellipse {...O_ELLIPSE} />
      {LETTERS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/*
  The short form: the O with the X shut inside it.

  A wordmark 3.6 times wider than it is tall cannot go in a 32px rail slot, a
  favicon or an app icon, so the compact mark takes the two letters that carry
  the identity — the ring and the pinched X — and stacks them. It reads as an
  aperture closing, which is the name.

  **The X is solid here and outlined in the wordmark, and that is deliberate.**
  Outlined, its two 1.8px strokes and the ring's collapse into a smudge at
  18px, which is the size the rail actually renders. A compact mark simplifies;
  it does not shrink.
*/
export function OptixGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("size-6", className)}
    >
      <circle cx="12" cy="12" r="8.6" />
      {/* Same proportions as the wordmark's X: the gap between the points is
          just over half the width. */}
      <path d="M7 7.4 H17 L14.6 12 L17 16.6 H7 L9.4 12 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/*
  Wordmark over the positioning line, for the pages somebody may be seeing the
  product on for the first time.

  It was a tile plus "Optix" set in Inter Tight until the artwork arrived. Type
  set to look like a logo is what you do when you have no logo.
*/
export function OptixLockup({
  className,
  tagline = false,
}: {
  className?: string;
  /* Off in the rail and the splash, on where the product is being introduced. */
  tagline?: boolean;
}) {
  return (
    /* `items-start`: an <svg> in a stretch-aligned flex column is stretched to
       the column's width and then centres its own artwork inside that box, so
       without this the mark floats to the middle of the page above a
       left-aligned tagline. */
    <div className={cn("flex flex-col items-start gap-2", className)}>
      <OptixWordmark className="h-8 text-brand-mark" />
      {tagline ? <span className="label-xs">Optix Technologies</span> : null}
    </div>
  );
}

/*
  The logo on its plate — the second supplied file, a navy stadium with the
  wordmark inside it.

  It exists for the surfaces the flat wordmark cannot hold: a photograph, or
  any light ground where yellow on white is a logo nobody can read. The plate
  carries its own two colours and ignores `currentColor` on purpose — a brand
  plate that themed with the page would defeat the reason it exists.

  ADR-7 says no pill shapes in this system and the only circle is the avatar.
  This is the supplied artwork rather than a UI container, so it keeps its
  radius; don't take it as licence for a rounded-full button.
*/
export function OptixPlate({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 261 96"
      fill="none"
      role="img"
      aria-label="Optix"
      className={cn("h-12 w-auto", className)}
    >
      <rect width="261" height="96" rx="48" fill="var(--brand-navy)" />
      <g
        /* The wordmark at 181 units wide, centred: 40 units of plate either
           side of it, 22 above and below. */
        transform="translate(40 22.75) scale(0.3535)"
        stroke="var(--brand-yellow)"
        strokeWidth={WORDMARK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <ellipse {...O_ELLIPSE} />
        {LETTERS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

/*
  The square plate: the same two colours around the short mark, for the slots
  that are square by construction — the rail head, the favicon, an app icon.
*/
export function OptixTile({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-md bg-brand-navy text-brand-yellow",
        className,
      )}
    >
      {/* A percentage WIDTH with the height left to the 1:1 viewBox, not
          `size-[62%]`: a percentage width always resolves against a definite
          containing block, a percentage height does not. */}
      <OptixGlyph className="h-auto w-[62%]" />
    </span>
  );
}
