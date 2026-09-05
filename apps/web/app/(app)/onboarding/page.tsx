"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, HardHat, Loader2, MapPin } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { OnboardingStep } from "@stinventory/api-contracts";
import { StepRail } from "@/components/onboarding/step-rail";
import { StepShell } from "@/components/onboarding/step-shell";
import { DetailsStep } from "@/components/onboarding/details-step";
import { LocationStep } from "@/components/onboarding/location-step";
import { CrewStep } from "@/components/onboarding/crew-step";
import { InviteStep } from "@/components/onboarding/invite-step";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";
import { cn } from "@/lib/utils";

/*
  First-run setup.

  Deliberately OUTSIDE the normal page furniture — no PageHeader, no table
  chrome. This is the one screen in the product a person sees before they know
  what the product is, and putting the shell's vocabulary around it asks them to
  parse the furniture before the question.

  What this screen does NOT do is write anything the person could not write
  themselves. Every roster write goes through `projectTeam.assign` under their
  own permissions: a superintendent puts their foremen on, and a foreman does
  not, because a foreman never could. A foreman's crew step is therefore a
  CONFIRMATION of what their superintendent already recorded, not an empty form
  they lack the rights to fill. Inventing an elevated path here would be a second
  way to write the roster, which is the pattern this codebase has paid for most.

  The invite step is the one place this changes shape by who is looking: sending
  an invite needs `user.manage`, which only office admins hold. Everyone else
  sees exactly who still needs an account and is told plainly that their office
  admin sends it — see `InviteStep`. There is no invented authority here either.
*/

const STEP_LABELS: Record<string, string> = {
  projects: "Your jobs",
  details: "Job details",
  location: "On the map",
  crew: "Your crew",
  invite: "Bring them in",
};

/* All five steps are built. Kept as a set (rather than always true) because it
   is the one place a step could be pulled from the rail again without
   touching the rail component itself. */
const IMPLEMENTED = new Set(["projects", "details", "location", "crew", "invite"]);

export default function OnboardingPage() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const state = trpc.onboarding.state.useQuery();
  const candidates = trpc.onboarding.candidateProjects.useQuery();
  const me = trpc.identity.me.useQuery();

  const steps = state.data?.steps ?? ["projects", "details", "location", "crew", "invite"];
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const setStep = trpc.onboarding.setStep.useMutation();
  const complete = trpc.onboarding.complete.useMutation({
    onSuccess: async () => {
      /* Invalidate before navigating: the shell's redirect reads this query, and
         leaving with a stale `shouldPrompt` bounces the person straight back. */
      await utils.onboarding.state.invalidate();
      router.replace("/home");
    },
    onError: (e) => setError(e.message),
  });

  const furthest = useMemo(() => {
    const at = steps.indexOf(state.data?.currentStep ?? "projects");
    return Math.max(at, index);
  }, [steps, state.data?.currentStep, index]);

  const go = (next: number) => {
    if (next < 0 || next >= steps.length) return;
    if (!IMPLEMENTED.has(steps[next]!)) return;
    setDirection(next > index ? 1 : -1);
    setIndex(next);
    setStep.mutate({ step: steps[next] as OnboardingStep });
  };

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const firstName = me.data?.firstName ?? "";
  const stepKey = steps[index] ?? "projects";
  const nextIsBuilt = IMPLEMENTED.has(steps[index + 1] ?? "");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-6">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-[4px] border border-primary/30 bg-primary/10 text-primary">
            <HardHat className="size-4" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              {firstName ? `Let's get you set up, ${firstName}` : "Let's get you set up"}
            </h1>
            <p className="text-xs text-muted-foreground">
              A few questions about the work you're on. You can leave and come back.
            </p>
          </div>
        </div>
        <StepRail
          steps={steps.map((k) => ({ key: k, label: STEP_LABELS[k] ?? k }))}
          activeIndex={index}
          furthestIndex={furthest}
          onJump={go}
        />
      </header>

      {error && <ErrorNote message={error} />}

      <StepShell stepKey={stepKey} direction={direction}>
        {stepKey === "projects" && (
          <section className="flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-medium">What are you working on?</h2>
              <p className="text-xs text-muted-foreground">
                Pick the jobs you're involved in. Ticking one doesn't put you on it — whoever runs
                the job still does that.
              </p>
            </div>

            {candidates.isLoading && <TableSkeleton />}
            {candidates.error && <ErrorNote message={candidates.error.message} />}

            {candidates.data && candidates.data.length === 0 && (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                There are no active jobs recorded yet.
              </p>
            )}

            <ul className="flex flex-col gap-2">
              {(candidates.data ?? []).map((p) => {
                const on = !!p.alreadyOn;
                const checked = on || picked.has(p.id);
                return (
                  <li key={p.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors",
                        checked ? "border-primary/40 bg-accent" : "hover:bg-muted/40",
                        on && "cursor-default opacity-90",
                      )}
                    >
                      <Checkbox checked={checked} disabled={on} onCheckedChange={() => toggle(p.id)} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {p.externalId ? `${p.externalId} · ` : ""}
                          {p.name}
                        </span>
                        {p.siteAddress && (
                          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <MapPin className="size-3 shrink-0" aria-hidden />
                            {p.siteAddress}
                          </span>
                        )}
                      </span>
                      {on && (
                        <span className="shrink-0 rounded-[3px] border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                          Already on
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {stepKey === "details" && <DetailsStep />}
        {stepKey === "location" && <LocationStep />}
        {stepKey === "crew" && <CrewStep />}
        {stepKey === "invite" && <InviteStep />}
      </StepShell>

      <footer className="flex items-center justify-between border-t pt-4">
        <Button variant="ghost" size="sm" onClick={() => go(index - 1)} disabled={index === 0}>
          <ArrowLeft className="mr-1.5 size-4" />
          Back
        </Button>

        <div className="flex items-center gap-2">
          {/*
            Dismissing is a first-class action, not a hidden escape. The gate
            fires once either way — see the app shell — so a person who has
            nothing to add says so and is not asked again.
          */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => complete.mutate({ dismissed: true })}
            disabled={complete.isPending}
          >
            Skip for now
          </Button>
          {nextIsBuilt ? (
            <Button size="sm" onClick={() => go(index + 1)}>
              Continue
              <ArrowRight className="ml-1.5 size-4" />
            </Button>
          ) : (
            <Button size="sm" onClick={() => complete.mutate({ dismissed: false })} disabled={complete.isPending}>
              {complete.isPending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Check className="mr-1.5 size-4" />
              )}
              Finish
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
