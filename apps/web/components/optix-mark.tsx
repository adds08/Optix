"use client";

import { cn } from "@/lib/utils";

/*
  The Optix mark.

  An iris: a hexagonal opening with six blades swung open to the rim. It is the
  literal reading of the name, and it earns its place beyond that — the product
  is a lens onto a fleet of tools that are otherwise only visible to whoever is
  standing next to them.

  Drawn rather than imported. It inherits `currentColor` and scales from the
  font size, so the same component is the 28px lockup on the sign-in page, the
  32px tile in the rail, and the 56px centre of the boot splash without three
  exported assets that can drift apart. The geometry below is generated (see
  the changelog entry) — hand-editing a coordinate will bend one blade and
  nothing will tell you.
*/

export function OptixGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("size-6", className)}
    >
      <circle cx="12" cy="12" r="8.6" />
      <path d="M15.68 14.12 L12.0 16.25 L8.32 14.12 L8.32 9.88 L12.0 7.75 L15.68 9.87 Z" />
      <path d="M15.68 14.12 L12.0 20.6 M12.0 16.25 L4.55 16.3 M8.32 14.12 L4.55 7.7 M8.32 9.88 L12.0 3.4 M12.0 7.75 L19.45 7.7 M15.68 9.87 L19.45 16.3" />
    </svg>
  );
}

/*
  The full lockup: mark in a primary tile, then the wordmark.

  "Optix" is set in the house sans with tight tracking rather than in a
  bespoke face — the product has one type pairing (ADR-7) and a logo that
  needs a fourth font is a logo that will render as system-ui the first time
  somebody loads it on a slow connection.
*/
export function OptixLockup({
  className,
  tagline = false,
}: {
  className?: string;
  /* The one-line positioning under the name. Off in the rail and the splash,
     on where somebody may be seeing the product for the first time. */
  tagline?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
        <OptixGlyph className="size-5" />
      </span>
      <span className="flex flex-col">
        <span className="text-[15px] font-semibold leading-none tracking-tight">Optix</span>
        {tagline ? (
          <span className="label-xs mt-1 leading-none">Optix Technologies</span>
        ) : null}
      </span>
    </div>
  );
}
