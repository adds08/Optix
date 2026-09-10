"use client";

import { useState } from "react";
import { Building2, Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";

/*
  Step two: only what is actually missing on the jobs just claimed.

  Reads `onboarding.myClaimedProjects`, which is scoped to jobs the caller
  holds a live roster row on — not `candidateProjects`' wider list, because
  filling in an address is an act ON a job, not a browse of what exists.

  A job with nothing missing renders as done rather than being silently
  dropped from the list — the plan is explicit that "complete" has to be a
  visible answer, not an absence a person has to infer.
*/
export function DetailsStep() {
  const utils = trpc.useUtils();
  const claimed = trpc.onboarding.myClaimedProjects.useQuery();
  const [drafts, setDrafts] = useState<Record<string, { siteAddress: string; description: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const fill = trpc.onboarding.fillDetails.useMutation({
    onSuccess: () => utils.onboarding.myClaimedProjects.invalidate(),
    onError: (e) => setError(e.message),
  });

  const draftFor = (id: string) => drafts[id] ?? { siteAddress: "", description: "" };
  const setDraft = (id: string, patch: Partial<{ siteAddress: string; description: string }>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...draftFor(id), ...patch } }));

  return (
    <section className="flex flex-col gap-4">
      {error && <ErrorNote message={error} />}
      {claimed.isLoading && <TableSkeleton />}
      {claimed.error && <ErrorNote message={claimed.error.message} />}

      {claimed.data && claimed.data.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          You're not on any jobs yet, so there's nothing to set here.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {(claimed.data ?? []).map((p) => {
          const gaps = p.missingSiteAddress || !p.description;
          const draft = draftFor(p.id);
          const savedThisRun = fill.isSuccess && fill.variables?.projectId === p.id;
          return (
            <li key={p.id} className="rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate text-sm font-medium">
                  {p.externalId ? `${p.externalId} · ` : ""}
                  {p.name}
                </span>
                {!gaps && (
                  <span className="ml-auto flex shrink-0 items-center gap-1 rounded-[3px] border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                    <Check className="size-3" aria-hidden />
                    Complete
                  </span>
                )}
              </div>

              {gaps && (
                <div className="mt-3 flex flex-col gap-2">
                  {p.missingSiteAddress && (
                    <div>
                      <label className="text-xs text-muted-foreground" htmlFor={`addr-${p.id}`}>
                        Site address
                      </label>
                      <Input
                        id={`addr-${p.id}`}
                        value={draft.siteAddress}
                        onChange={(e) => setDraft(p.id, { siteAddress: e.target.value })}
                        placeholder="Where the job physically is"
                      />
                    </div>
                  )}
                  {!p.description && (
                    <div>
                      <label className="text-xs text-muted-foreground" htmlFor={`desc-${p.id}`}>
                        Description
                      </label>
                      <textarea
                        id={`desc-${p.id}`}
                        value={draft.description}
                        onChange={(e) => setDraft(p.id, { description: e.target.value })}
                        placeholder="Anything a boss coming after you should know"
                        rows={2}
                        className="flex min-h-[64px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground resize-y"
                      />
                    </div>
                  )}
                  <Button
                    size="sm"
                    className="self-start"
                    disabled={fill.isPending || (!draft.siteAddress && !draft.description)}
                    onClick={() =>
                      fill.mutate({
                        projectId: p.id,
                        siteAddress: draft.siteAddress || undefined,
                        description: draft.description || undefined,
                      })
                    }
                  >
                    Save
                  </Button>
                  {savedThisRun && <p className="text-xs text-muted-foreground">Saved.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
