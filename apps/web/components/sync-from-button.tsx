"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/*
  "Sync from" — pull people from a far system.

  A MENU rather than a bare button because there will be more than one source:
  this codebase's own comments already name BambooHR, Mark 85 and
  FoundationSoft, and a second flat button per system is how a toolbar stops
  fitting. Only BambooHR is built; the rest are not listed until they are.

  WHAT PRESSING IT DOES. It queues a row and returns — it does not hold the
  request open, because the work is a paginated network fetch plus a few
  hundred writes. The panel below then polls `sync.latest` while a run is
  queued or running, which is the same shape the chat screen uses for a queued
  message. That is why there is no spinner-until-done: the run outlives the
  click, and a person can navigate away and come back to it.

  PREVIEW IS THE DEFAULT ACTION and Apply is the second item, deliberately
  ordered that way. A preview writes nothing at all, so the safe option is the
  one under the cursor when the menu opens.
*/

type Run = {
  id: string;
  mode: string;
  status: string;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  refusedCount: number;
  flaggedCount: number;
  errorNote: string | null;
  detail: unknown;
  finishedAt: string | Date | null;
};

type PersonPlan = {
  label: string;
  action: string;
  changes: { field: string; from: string | null; to: string }[];
  needsConfirming: { field: string; from: string | null; to: string }[];
  flaggedInactive: boolean;
  withheld: string[];
};

export function SyncFromButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const latest = trpc.sync.latest.useQuery(undefined, {
    /* Poll only while something is actually in flight. A screen that polls
       forever is a screen that keeps a laptop awake for no reason — the same
       reasoning as the chat page's two refetch intervals. */
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "queued" || s === "running" ? 2000 : false;
    },
  });

  const start = trpc.sync.start.useMutation({
    onSuccess: async () => {
      setError(null);
      setOpen(true);
      await utils.sync.latest.invalidate();
    },
    onError: (e) => {
      setError(e.message);
      setOpen(true);
    },
  });

  const run = latest.data as Run | null | undefined;
  const busy = run?.status === "queued" || run?.status === "running";

  return (
    <Can perm="employee.manage">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* `size="default"` (34px) to match Import and New person beside it —
              a toolbar where one control is a different height reads as broken. */}
          <Button size="default" variant="outline" disabled={start.isPending || busy}>
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden />
            )}
            {busy ? "Syncing…" : "Sync from"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>BambooHR</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => start.mutate({ source: "bamboohr", mode: "preview" })}
          >
            <div className="flex flex-col gap-0.5">
              <span>Preview changes</span>
              <span className="text-xs text-muted-foreground">
                Reads only. Writes nothing.
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => start.mutate({ source: "bamboohr", mode: "apply" })}
          >
            <div className="flex flex-col gap-0.5">
              <span>Sync now</span>
              <span className="text-xs text-muted-foreground">
                Adds and updates people.
              </span>
            </div>
          </DropdownMenuItem>
          {run ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setOpen(true)}>
                Last result…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {open ? (
        <SyncResultDialog
          run={run ?? null}
          error={error}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Can>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "ok" }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2">
      <span className="label-xs">{label}</span>
      <span
        className={cn(
          "tnum text-xl font-semibold tracking-tight",
          tone === "warn" && value > 0 ? "text-warn" : tone === "ok" && value > 0 ? "text-ok" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function SyncResultDialog({
  run,
  error,
  onClose,
}: {
  run: Run | null;
  error: string | null;
  onClose: () => void;
}) {
  const busy = run?.status === "queued" || run?.status === "running";
  const detail = (run?.detail as { people?: PersonPlan[] } | null) ?? null;
  const people = detail?.people ?? [];

  /* The two categories a human has to act on, pulled to the front. Everything
     else is a number they can glance at. A list of eighty-three rows where
     four need attention is a list nobody reads. */
  const needsConfirming = people.filter((p) => p.needsConfirming.length > 0);
  const flagged = people.filter((p) => p.flaggedInactive);

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {run?.mode === "apply" ? "Sync from BambooHR" : "Preview — BambooHR"}
          </DialogTitle>
          <DialogDescription>
            {run?.mode === "apply"
              ? "People added and updated from BambooHR."
              : "What a sync would change. Nothing has been written."}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="flex items-start gap-2 rounded-[3px] border border-crit/30 bg-crit-bg px-3 py-2 text-xs text-crit">
            <X className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}

        {busy ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Reading the roster from BambooHR…
          </p>
        ) : null}

        {run?.status === "failed" ? (
          <p className="flex items-start gap-2 rounded-[3px] border border-crit/30 bg-crit-bg px-3 py-2 text-xs text-crit">
            <X className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{run.errorNote ?? "The sync failed."}</span>
          </p>
        ) : null}

        {run?.status === "done" ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Added" value={run.createdCount} tone="ok" />
              <Stat label="Updated" value={run.updatedCount} tone="ok" />
              <Stat label="Unchanged" value={run.skippedCount} />
              <Stat label="Flagged" value={run.flaggedCount} tone="warn" />
              <Stat label="Refused" value={run.refusedCount} tone="warn" />
            </div>

            {/*
              These two blocks are the point of the dialog. A sync that reports
              only totals makes the person who pressed it go and diff eighty
              rows by hand.
            */}
            {needsConfirming.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <AlertTriangle className="size-3.5 text-warn" aria-hidden />
                  Needs your decision ({needsConfirming.length})
                </h3>
                <p className="text-xs text-muted-foreground">
                  A badge number or a name differs from what Optix has. These are never
                  overwritten automatically — a name is how two people get merged by
                  accident.
                </p>
                <ul className="sti-scroll flex max-h-48 flex-col divide-y rounded-md border">
                  {needsConfirming.map((p) => (
                    <li key={p.label} className="flex flex-col gap-0.5 px-3 py-2 text-xs">
                      <span className="font-medium">{p.label}</span>
                      {p.needsConfirming.map((c) => (
                        <span key={c.field} className="text-muted-foreground">
                          {c.field}: <span className="line-through">{c.from ?? "—"}</span>{" "}
                          &rarr; <span className="text-foreground">{c.to}</span>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {flagged.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <AlertTriangle className="size-3.5 text-warn" aria-hidden />
                  No longer active in BambooHR ({flagged.length})
                </h3>
                <p className="text-xs text-muted-foreground">
                  Flagged only. The sync never deactivates anybody — someone holding tools
                  has to be dealt with by a person, not by an import.
                </p>
                <ul className="sti-scroll flex max-h-32 flex-col divide-y rounded-md border">
                  {flagged.map((p) => (
                    <li key={p.label} className="px-3 py-1.5 text-xs">
                      {p.label}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {needsConfirming.length === 0 && flagged.length === 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="size-3.5 text-ok" aria-hidden />
                Nothing needs a decision.
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
