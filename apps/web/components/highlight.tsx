"use client";

import { cn } from "@/lib/utils";

/*
  The search-match marker for the jobsite list.

  Three rules keep it from interfering with the UI:
    - it only appears once the search is four letters or longer, so a stray
      "a" or "IC" does not paint the page yellow,
    - it marks the first match in the text, case-insensitively, leaving the
      rest of the string untouched (no layout shift, no re-wrapping beyond the
      mark itself),
    - it is a soft warn-tinted mark that inherits the surrounding text color,
      so on tinted backgrounds it reads as "this is what matched", not as a
      new color block.
*/

export function Highlight({ text, q, className }: { text: string; q?: string | null; className?: string }) {
  const needle = q?.trim();
  if (!text || !needle || needle.length < 4) return <>{text}</>;
  const lower = text.toLowerCase();
  const at = lower.indexOf(needle.toLowerCase());
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className={cn("rounded-[2px] bg-warn/25 px-px text-inherit", className)}>
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length)}
    </>
  );
}
