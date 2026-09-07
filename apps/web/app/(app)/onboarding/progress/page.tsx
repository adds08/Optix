"use client";

import { AlertTriangle, Building2, Check, MapPin, User, UserCheck, X } from "lucide-react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { PageHeader, EmptyState, ErrorNote, Metric, TableSkeleton } from "@/components/sti/page";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useState } from "react";

/*
  Who below the caller has stood up their jobs and their crew.

  NOT a revival of `/desk`. That was a general command surface with a panel
  registry, deleted 2026-09-03 after the user escalated a documentation fix
  to a full removal and confirmed it twice. This is a single, specific
  question — has the person below me claimed their jobs, filled in the gaps,
  and named their own crew — with one route, one nav id, and no panels. If
  this page ever grows toward "everything a boss might want to see", that is
  the moment to stop and ask, not to let it happen by accretion.

  Everything here is DERIVED, computed fresh by `onboarding.progress` from the
  roster, the account table and the onboarding-state row. There is no stored
  percentage anywhere in this stack for the same reason the plan gives at
  length: a number that can disagree with the rows underneath it is worse
  than no number.

  Reachable by anyone holding `project.team.read` — every foreman included —
  and the empty state below is not an error, it is the honest answer for
  somebody with nobody reporting to them.
*/

type Tab = "byJob" | "byPerson";

export default function OnboardingProgressPage() {
  const [tab, setTab] = useState<Tab>("byJob");
  const progress = trpc.onboarding.progress.useQuery();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Onboarding"
        description="Who below you has claimed their jobs, filled in the gaps, and named their own crew."
      />

      {progress.isLoading && <TableSkeleton />}
      {progress.error && <ErrorNote message={progress.error.message} />}

      {progress.data && progress.data.byJob.length === 0 && progress.data.byPerson.length === 0 && (
        <EmptyState
          title="Nobody reports to you yet"
          description="Once somebody is on a job you run, their setup shows up here."
        />
      )}

      {progress.data && (progress.data.byJob.length > 0 || progress.data.byPerson.length > 0) && (
        <>
          <SetupSummary
            byJob={progress.data.byJob}
            byPerson={progress.data.byPerson}
            scoped={progress.data.scoped}
          />

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              <TabsTrigger value="byJob">By job</TabsTrigger>
              <TabsTrigger value="byPerson">By person</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === "byJob" && (
            <ul className="flex flex-col gap-3">
              {progress.data.byJob.map((job) => {
                const total = job.rosterCount;
                const done = job.confirmedCount;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <li key={job.projectId} className="rounded-lg border bg-card p-4 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      {job.projectExternalId && (
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {job.projectExternalId}
                        </span>
                      )}
                      <span className="truncate font-display text-sm font-semibold tracking-tight">
                        {job.projectName}
                      </span>
                      <span
                        className={cn(
                          "ml-auto flex shrink-0 items-center gap-1 text-xs",
                          /* "Not on the map" is a gap somebody has to close,
                             so it is not the same grey as everything else.
                             Amber, not red: an unpinned job is unfinished
                             setup, never a fault. */
                          job.hasLocation ? "text-muted-foreground" : "text-warn",
                        )}
                      >
                        <MapPin className="size-3" aria-hidden />
                        {job.hasLocation ? "Located" : "Not on the map"}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center gap-2.5">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            /* `--ok` is the reserved status hue; emerald-500
                               was a raw Tailwind colour that ignored the
                               palette and stayed the same green on every
                               theme. */
                            pct === 100 ? "bg-ok" : "bg-primary",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {done}/{total} confirmed
                      </span>
                    </div>

                    {job.openDeferrals.length > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-1.5">
                        {job.openDeferrals.map((d) => (
                          <li
                            key={d.teamRole}
                            /* `--warn` rather than a raw amber: this is the
                               reserved status hue, and the pair of Tailwind
                               ambers here needed a `dark:` variant to stay
                               legible where the token already handles it. */
                            className="flex items-center gap-1.5 rounded-[3px] border border-warn/30 bg-warn-bg px-2 py-1 text-xs text-warn"
                          >
                            <AlertTriangle className="size-3" aria-hidden />
                            {d.label} left for you to name
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {tab === "byPerson" && (
            <ul className="flex flex-col gap-2">
              {progress.data.byPerson.map((p) => (
                <li
                  key={p.employeeId}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-sm"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <User className="size-3.5" aria-hidden />
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
                  <StatusPill ok={p.hasAccount} okLabel="Has account" noLabel="No account" />
                  <StatusPill ok={p.everSignedIn} okLabel="Signed in" noLabel="Never signed in" />
                  <StatusPill ok={p.onboardingComplete} okLabel="Set up" noLabel="Pending" />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/*
  The three numbers an admin came for, and the reason they are zero.

  This page answered "how is each job doing" once per card and never answered
  "how is the whole thing doing" at all. On a tenant where nothing has been set
  up that means twenty identical rows of `0/5 confirmed`, which reads as a
  broken screen rather than an empty one — and the actual blocker is named
  nowhere on it. Reported by the user, 2026-09-07, in exactly those terms:
  the page does not give much information to admins.

  DERIVED IN THE BROWSER from the two arrays already fetched — no new
  procedure, no second query, and deliberately no stored total. Same reasoning
  as the file header: a number that can disagree with the rows underneath it is
  worse than no number, and these cannot, because they are a fold over those
  exact rows.

  The blocker note is the point of the whole component. `0/N confirmed` is a
  SYMPTOM: nobody can confirm a crew they cannot sign in to see. Stating the
  cause once, with the screen that fixes it one click away, is the difference
  between a report and a next action.
*/
function SetupSummary({
  byJob,
  byPerson,
  scoped,
}: {
  byJob: { hasLocation: boolean }[];
  byPerson: { hasAccount: boolean; onboardingComplete: boolean }[];
  scoped: boolean;
}) {
  const jobs = byJob.length;
  const pinned = byJob.filter((j) => j.hasLocation).length;
  const people = byPerson.length;
  const withAccount = byPerson.filter((p) => p.hasAccount).length;
  const setUp = byPerson.filter((p) => p.onboardingComplete).length;

  /* Nobody without an account can ever complete setup, so this is the one
     number that gates the other two. It earns the amber; `setUp` deliberately
     does not, because a rail on a consequence points the eye away from the
     cause. `Metric`'s own comment is explicit that a coloured rail is the
     exception, not the default. */
  const cannotBeInvited = people - withAccount;

  /* "of your reports" vs "in this tenant" is not decoration — the procedure
     scopes its rows by view tier, so an admin's totals and a superintendent's
     totals are answers to different questions and must not be read as one. */
  const whose = scoped ? "of your reports" : "in this tenant";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Crewed jobs on the map"
          value={`${pinned}/${jobs}`}
          hint={pinned === jobs ? "Every crewed job has a pin" : `${jobs - pinned} still to place`}
          tone={jobs > 0 && pinned === jobs ? "ok" : pinned === 0 ? "warn" : "default"}
          icon={MapPin}
        />
        <Metric
          label="Crew who can sign in"
          value={`${withAccount}/${people}`}
          hint={cannotBeInvited > 0 ? `${cannotBeInvited} without an account` : `Everyone ${whose} has one`}
          tone={people > 0 && withAccount === people ? "ok" : "warn"}
          icon={UserCheck}
        />
        <Metric
          label="Crew finished setup"
          value={`${setUp}/${people}`}
          hint={setUp === people && people > 0 ? "Nothing outstanding" : `${people - setUp} pending`}
          tone={people > 0 && setUp === people ? "ok" : "default"}
          icon={Check}
        />
      </div>

      {/*
        The denominators are NOT the tenant's totals, and saying so is not
        pedantry — it is the difference between "we have 11 jobs" and the truth.
        `onboarding.progress` derives every row from live crew membership, so a
        job with nobody on it and a person on no job are both absent by
        construction. Verified against the running stack: 11 of Urban's 20 jobs
        have a crew and 44 of its 83 people are on one, so an admin reading
        `0/11` as the whole register would be wrong by nine jobs.

        The tenant totals are deliberately NOT fetched to sit beside these. That
        needs a second query for a number this page was not asked to answer, and
        the file header is explicit that growing this screen toward everything a
        boss might want is a stop-and-ask, not a free addition.
      */}
      <p className="text-xs text-muted-foreground">
        Counts cover only jobs that have a crew, and people on one. A job with nobody assigned
        does not appear here.
      </p>

      {cannotBeInvited > 0 && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-[3px] border border-warn/30 bg-warn-bg px-3 py-2 text-xs text-warn">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">
              {cannotBeInvited} {cannotBeInvited === 1 ? "person" : "people"} cannot be invited yet.
            </strong>{" "}
            An account needs an email address on the person&apos;s record, and nobody can confirm a
            crew before they can sign in — so every count above stays at zero until that is filled
            in.
          </span>
          <Link href="/people" className="shrink-0 font-semibold underline underline-offset-2">
            Open People
          </Link>
        </p>
      )}
    </div>
  );
}

function StatusPill({ ok, okLabel, noLabel }: { ok: boolean; okLabel: string; noLabel: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        ok ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {ok ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
      {ok ? okLabel : noLabel}
    </span>
  );
}
