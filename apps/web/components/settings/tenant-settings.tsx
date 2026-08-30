"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/sti/page";
import { dateTime } from "@/lib/format";

/*
  Shared scaffolding for the tenant-configuration pages.

  Settings was one 432-line page until the rail gained a Settings group and its
  sections became routes. Splitting it duplicated the query, the save mutation
  and — dangerously — the hydrate-once guard, whose absence is a bug this
  codebase has already shipped and fixed. Both halves live here so there is one
  copy of the rule and one place its rationale is written down.

  `settings.update` takes every field as `.optional()`, so each page saves only
  what it owns and no page can blank another's fields by being open.
*/

export function useTenantSettings(onSaved?: () => void) {
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = trpc.settings.update.useMutation({
    onSuccess: () => {
      setError(null);
      setSaved(true);
      onSaved?.();
      utils.settings.get.invalidate();
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e) => setError(e.message),
  });

  return { settings, s: settings.data, save, saved, error, setError };
}

/*
  Populate from the server exactly once.

  This used to depend on the settings object alone, which looks right and is
  not: react-query refetches on window focus by default, and every refetch
  produced a fresh object, re-ran the effect and stamped the saved values back
  over whatever was half-typed. Switching to another tab and back — or to the
  terminal to copy an API key, which is precisely what these pages are for —
  silently emptied the fields.

  A ref rather than state because the guard must not itself cause a render, and
  it must be set in the same pass that does the hydrating.
*/
export function useHydrateOnce<T>(
  value: T | null | undefined,
  hydrate: (v: NonNullable<T>) => void,
): void {
  const done = useRef(false);
  useEffect(() => {
    if (value === undefined || value === null || done.current) return;
    done.current = true;
    hydrate(value as NonNullable<T>);
    /* `hydrate` is a fresh closure on every render, so this effect re-runs
       constantly and the ref above is the only thing that makes it a no-op.
       That is the intended arrangement: the guard, not the dependency list, is
       what enforces "once". */
  }, [value, hydrate]);
}

export function SaveBar({
  onSave,
  pending,
  saved,
  error,
  updatedAt,
}: {
  onSave: () => void;
  pending: boolean;
  saved: boolean;
  error: string | null;
  updatedAt?: string | Date | null;
}) {
  return (
    <>
      {error ? <ErrorNote message={error} /> : null}
      <div className="flex items-center gap-3">
        <Button disabled={pending} onClick={onSave}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Save
        </Button>
        {saved ? (
          <span className="flex items-center gap-1.5 text-sm text-ok">
            <Check className="size-4" /> Saved
          </span>
        ) : null}
        {updatedAt ? (
          <span className="text-xs text-muted-foreground">Last changed {dateTime(updatedAt)}</span>
        ) : null}
      </div>
    </>
  );
}
