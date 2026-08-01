"use client";

import { useIsMutating } from "@tanstack/react-query";

/*
  The global "something is being written" bar (docs/20, F).

  TanStack already counts in-flight mutations — every mutation in the app
  flows through one client — so this bar is one hook and a strip of CSS. It
  is deliberately a thin, quiet line at the very top: the desk needs to know
  a save is landing without being told to wait on it.
*/
export function WorkingBar() {
  const mutating = useIsMutating();
  if (!mutating) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[80] h-0.5 overflow-hidden">
      <div className="h-full w-1/3 animate-[sti-slide_1s_ease-in-out_infinite] bg-primary" />
    </div>
  );
}
