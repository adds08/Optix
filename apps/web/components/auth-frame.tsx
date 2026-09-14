"use client";

import { AuthSlideshow, type AuthSlide } from "@/components/auth-slideshow";
import { OptixPlate } from "@/components/optix-mark";

/*
  THE ONE SCREEN THE AUTH FAMILY SHARES.

  `/`, `/forgot-password`, `/reset/[token]` and `/invite/[token]` are four
  doors into the same product and were three different screens: sign-in was a
  two-column panel with the photograph, forgot-password was a bare centred
  column, and the token pages were a bordered card. Somebody following "Forgot
  password?" out of sign-in and back through an email crossed three layouts to
  do one thing, and the product looked like three products.

  So the shell lives here: photograph left, one 364px column right, and the
  marks centred above it. Pages pass their own content and nothing else.

  ONE OPTIX MARK, and it is the centred plate. The photograph carried its own
  plate in the corner until now, which put the same logo on screen twice; the
  panel's corner belongs to the tenant instead.

  THE TENANT'S MARK, on the photograph — where it actually reads. The artwork
  is yellow and green on transparent, so on the white form it washes out, which
  is exactly how it looked. On the dark scrim both colours carry, and it can be
  large enough to be the company's name rather than a smudge. Below `lg` the
  panel is gone, so the mark reappears in the column — the only place a phone
  can see whose account this is.

  HARDCODED, and knowingly so. Optix is a multi-tenant product and this belongs
  on `tenant_settings` beside the SMTP and LLM configuration, resolved from the
  subdomain the way `login()` already accepts an optional `tenantSlug`. That is
  a real change — an upload, a storage key, a fallback for a tenant with no
  artwork — and inventing half of it here would leave a column nothing writes.
  One tenant, one file, and a comment saying which part is temporary.

  `OptixPlate`, not the bare wordmark: the plate is the supplied artwork for a
  light ground, where the yellow wordmark alone would be unreadable.
*/
export function AuthFrame({ children, slide }: { children: React.ReactNode; slide?: AuthSlide }) {
  return (
    <main className="grid min-h-svh lg:grid-cols-[1.4fr_1fr]">
      {/* The job, photographed — left. The form is the task; this panel is the
          reason to bother, and it must never slow the form, which is why it
          paints with backgrounds a narrow viewport never fetches. */}
      <aside className="relative hidden overflow-hidden lg:block">
        <AuthSlideshow slide={slide} showMark={false} tenantLogo="/assets/urban_logo.svg" />
      </aside>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-[364px] flex-col gap-8">
          <div className="flex flex-col items-center gap-5">
            <img
              src="/assets/urban_logo.svg"
              alt="Urban Infraconstruction"
              className="h-10 w-auto lg:hidden"
            />
            <OptixPlate className="h-11" />
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
