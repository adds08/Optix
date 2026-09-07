"use client";

import { useState } from "react";
import { AlertTriangle, ArrowDown, Check, Equal, UsersRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { EntityField } from "@/components/ui/entity-picker";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { cn } from "@/lib/utils";

/*
  "My Crew" — claim the people who answer to you, job by job.

  THE DIRECTION IS THE POINT. `/onboarding` step four asks a person being
  onboarded to name their boss and their own crew, one tier each way. This is
  the other shape entirely: a superior looks down the whole ladder beneath them
  and says "these are mine". The client's words on 2026-09-07: "a director
  saying this is my PM, these are my superintendents would also mean a foreman
  saying i am working under this director".

  No reverse edge is stored for that. `project_team_member.reportsToEmployeeId`
  is one directed edge and the foreman's own view of it falls out of the same
  column read the other way — see the org chart, which does exactly that.

  Everything here goes through `projectTeam.assign` under the caller's own
  permission, which is the same chokepoint the jobsite hub and the wizard use.
  This screen invents no elevated path: `canAssign` per tier only decides
  whether a picker is drawn, and `assertCanAssign` on the server is what
  actually refuses.
*/
export default function MyCrewPage() {
  const utils = trpc.useUtils();
  const crew = trpc.projectTeam.myCrew.useQuery();
  const [error, setError] = useState<string | null>(null);
  /* Keyed by `${projectId}:${teamRoleName}` — one open picker per tier per job,
     because a person claiming a crew works down a list and a single shared
     value would clear the row they just filled. See the key's own comment
     below for why the NAME and not the id. */
  const [picking, setPicking] = useState<Record<string, string>>({});

  const assign = trpc.projectTeam.assign.useMutation({
    onSuccess: (_d, vars) => {
      /* Clear only the tier that succeeded, so somebody working down a crew
         keeps their other half-made selections. */
      setPicking((prev) => {
        const next = { ...prev };
        delete next[`${vars.projectId}:${vars.role}`];
        return next;
      });
      utils.projectTeam.myCrew.invalidate();
      /* The org chart reads the rows this just wrote. */
      utils.projectTeam.all.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const confirm = trpc.projectTeam.confirm.useMutation({
    onSuccess: () => {
      utils.projectTeam.myCrew.invalidate();
      utils.projectTeam.all.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={UsersRound}
        title="My Crew"
        description="Everyone at or below you on the jobs you run. Nothing above you is shown."
      />

      {error && <ErrorNote message={error} />}
      {crew.isLoading && <TableSkeleton cols={4} />}
      {crew.isError && <ErrorNote message="Your crew could not be loaded." />}

      {crew.data && crew.data.length === 0 && (
        <EmptyState
          icon={UsersRound}
          title="You're not on any jobs yet"
          description="A crew hangs off a job. Once you hold a team role on one, everyone at or below you shows up here to claim."
        />
      )}

      <div className="flex flex-col gap-6">
        {(crew.data ?? []).map((job) => (
          <section key={job.projectId} className="flex flex-col gap-2">
            <header className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-medium">
                {/* Code before name, the register's convention throughout. */}
                {job.projectCode ? `${job.projectCode} - ${job.projectName}` : job.projectName}
              </h2>
              <span className="text-xs text-muted-foreground">
                you are {job.myTeamRoleLabel} here
              </span>
            </header>

            {!job.myTierPlaced && (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Your company hasn't placed {job.myTeamRoleLabel} in the reporting ladder yet, so
                there is nothing below it to claim. An administrator sets that on Settings → Team
                Roles.
              </p>
            )}

            <ul className="flex flex-col gap-2">
              {job.tiers.map((tier) => {
                /* Keyed by role NAME, not teamRoleId, because that is what `assign`
                   echoes back in `onSuccess` — keying by the id meant the clear
                   below never matched and a successful add left its selection
                   and its skip warning sitting on screen. Name is unique per
                   tenant, so it is just as good a key. */
                const pickKey = `${job.projectId}:${tier.teamRoleName}`;
                const picked = picking[pickKey] ?? "";
                /* THE SKIP WARNING. Advisory, never a block — settled with the
                   client: "they will get a warning but they can do it". Only
                   raised once somebody is actually picked, because a permanent
                   banner on every distant tier is noise on a screen whose whole
                   job is to show distant tiers. */
                const skipping = tier.hops > 1 && tier.skipsTiers.length > 0;
                const warn = skipping && !!picked;

                return (
                  <li key={pickKey} className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="flex size-6 shrink-0 items-center justify-center rounded-[4px] border border-border bg-muted/40 text-muted-foreground"
                        title={tier.hops === 0 ? "Your own tier" : `${tier.hops} below you`}
                      >
                        {tier.hops === 0 ? (
                          <Equal className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3.5" aria-hidden />
                        )}
                      </span>

                      <span className="w-40 shrink-0 truncate text-sm font-medium">
                        {tier.label}
                        {tier.hops === 0 && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            (same tier)
                          </span>
                        )}
                      </span>

                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        {tier.filled.map((f) => (
                          <span
                            key={f.id}
                            className={cn(
                              "flex items-center gap-1.5 rounded-[3px] border px-2 py-1 text-xs",
                              f.confirmed
                                ? "border-border bg-muted/40"
                                : "border-primary/40 bg-accent",
                            )}
                          >
                            {f.employeeName}
                            {f.reportsToMe && (
                              <span className="text-[10px] text-muted-foreground">yours</span>
                            )}
                            {f.confirmed ? (
                              <Check className="size-3 text-primary" aria-hidden />
                            ) : tier.canAssign ? (
                              <button
                                type="button"
                                className="rounded-[2px] px-1 text-[10px] font-medium text-primary underline underline-offset-2 transition-colors hover:text-foreground disabled:opacity-50"
                                disabled={confirm.isPending}
                                onClick={() => confirm.mutate({ id: f.id })}
                              >
                                Confirm
                              </button>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">unconfirmed</span>
                            )}
                          </span>
                        ))}
                        {tier.filled.length === 0 && !tier.canAssign && (
                          <span className="text-xs text-muted-foreground">
                            Nobody yet, and not yours to name.
                          </span>
                        )}
                      </div>

                      {tier.canAssign && (
                        <div className="flex shrink-0 items-center gap-2">
                          <EntityField
                            options={job.candidates.map((c) => ({
                              value: c.id,
                              label: c.name,
                              hint: c.code ?? undefined,
                            }))}
                            value={picked}
                            onChange={(v) => setPicking((prev) => ({ ...prev, [pickKey]: v }))}
                            placeholder={`Add a ${tier.label.toLowerCase()}`}
                            searchPlaceholder="Name or employee number"
                            emptyLabel="Nobody eligible."
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!picked || assign.isPending}
                            onClick={() =>
                              assign.mutate({
                                projectId: job.projectId,
                                employeeId: picked,
                                role: tier.teamRoleName,
                                /* THE CLAIM ITSELF: they answer to me.

                                   Not `null`. Null is a legal value meaning
                                   "no boss recorded yet" and is the opposite
                                   of what this screen asserts — the first cut
                                   sent it and wrote rows that claimed nothing,
                                   which typechecked, looked right, and was
                                   only caught by reading a row back after
                                   clicking Add. */
                                reportsToEmployeeId: job.myEmployeeId,
                              })
                            }
                          >
                            {warn ? "Add anyway" : "Add"}
                          </Button>
                        </div>
                      )}
                    </div>

                    {warn && (
                      <p className="flex items-start gap-1.5 rounded-[3px] border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>
                          This skips {tier.skipsTiers.join(", ")}. They'll answer straight to you
                          instead of through {tier.skipsTiers.length === 1 ? "that tier" : "those tiers"}.
                          That's allowed — carry on if it's how the job actually runs.
                        </span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
