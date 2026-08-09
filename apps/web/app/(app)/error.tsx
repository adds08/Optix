"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
  The boundary for everything inside the app shell.

  Without one, a render error anywhere under `(app)` unmounts the whole tree and
  the user gets a blank white page — no nav, no way back, nothing to report. The
  shell (sidebar, top bar) lives in this segment's layout and survives, so what
  a foreman actually sees is one broken panel rather than a dead browser tab.

  `reset()` re-renders the segment rather than reloading the document. Most
  failures here are a query that threw on bad data; re-running it is genuinely
  often enough, and it keeps the app's state and scroll position.
*/
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /* Nothing collects browser errors yet, so the console is the only record
       there is. Keep the digest — it is the one token that ties a user's
       report to the server-side log line for the same failure. */
    console.error("[app] render error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    /* A plain panel, not the grid-paper one `EmptyState` uses. An empty
       register is a drawing nobody has made yet; this is a drawing that tore.
       They should not look alike. */
    <div className="rounded-md border bg-card px-6 py-14">
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden
          className="flex size-11 items-center justify-center rounded-full bg-crit-bg text-crit"
        >
          <TriangleAlert className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="font-medium">This screen could not be displayed</p>
          <p className="mx-auto max-w-[46ch] text-sm text-muted-foreground text-pretty">
            Nothing was changed and no record was lost. Try again — if it keeps
            happening, tell the equipment desk and quote the reference below.
          </p>
        </div>
        <Button onClick={reset} size="sm" variant="outline">
          <RotateCw className="size-4" />
          Try again
        </Button>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">Reference {error.digest}</p>
        ) : null}
      </div>
    </div>
  );
}
