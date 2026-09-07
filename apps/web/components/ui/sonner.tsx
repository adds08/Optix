"use client";

import { Toaster as Sonner } from "sonner";
import { useThemeStore } from "@/lib/themes/store";

/*
  The one toast surface.

  `sonner` has been a dependency of this app since before 2026-09-07 and was
  imported by nothing — no Toaster mounted, no `toast()` call in any of the
  sixty-eight mutation call sites. The feedback model was: failures print an
  inline `ErrorNote`, successes say nothing at all and you infer the outcome
  from the table refetching underneath you.

  That is survivable for a create you can see land in a row and actively bad for
  an invite, where the observable change is one cell flipping from "Not invited"
  to "Invited" and the actual effect — mail leaving the building — happens in
  somebody else's inbox where the sender cannot check it.

  THEME COMES FROM THE STORE, not from `next-themes`, which this app does not
  use. `useThemeStore` is the same source of truth the shell's `applyTheme`
  effect reads, so a toast cannot end up light while the app is dark.

  Styled through `--normal-*` rather than per-toast classNames so that the
  palette follows the tenant's theme automatically — the tokens are the ones
  every other surface already resolves. Borders and no shadow, matching the
  house rule in `.claude/rules/web.md`: depth comes from borders here.
*/
export function Toaster() {
  const dark = useThemeStore((s) => s.dark);
  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      /* Bottom-right: the top bar carries search, notifications and the account
         menu, and the bottom-LEFT is where the sidebar footer and (in dev) the
         Next.js indicator already sit. */
      position="bottom-right"
      /* The house radius is tight — 6px — and set in globals.css. */
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "rounded-md border shadow-none",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}
