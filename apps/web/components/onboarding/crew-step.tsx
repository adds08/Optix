"use client";

import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, Undo2, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { EntityField } from "@/components/ui/entity-picker";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";
import { cn } from "@/lib/utils";
import { personHint } from "@/lib/format";

/*
  Step four: who is above and below you, per the company's declared ladder.

  Reads `onboarding.crewStatus`, which does all the deciding server-side — this
  component only renders three states per tier and fires the matching action:

    - FILLED, unconfirmed  -> a confirm button. Somebody below already recorded
      this; the boss (this caller, if `canAssign`) verifies it once.
    - EMPTY, `canAssign`   -> a person picker, wired to `projectTeam.assign`
      under the caller's OWN permission — the exact chokepoint the jobsite hub
      uses. This step invents no elevated path.
    - EMPTY, not `canAssign` -> the defer toggle. "My PM will do this" is
      recorded as a fact, not left as a silent gap.

  A FILLED tier the caller cannot confirm (case: `canAssign` false but a row
  exists) still shows read-only, because seeing what a subordinate recorded is
  the whole value of doing this after them — see the plan's boss-verifies note.
*/
export function CrewStep() {
  const utils = trpc.useUtils();
  const crew = trpc.onboarding.crewStatus.useQuery();
  const employees = trpc.employee.list.useQuery();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<Record<string, string>>({});

  const invalidate = () => {
    utils.onboarding.crewStatus.invalidate();
  };

  const confirm = trpc.projectTeam.confirm.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });
  const assign = trpc.projectTeam.assign.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });
  const undefer = trpc.onboarding.undefer.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });
  const defer = trpc.onboarding.defer.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });

  const employeeOptions = (employees.data ?? [])
    .filter((e) => e.employmentStatus === "active")
    .map((e) => ({ value: e.id, label: e.name, hint: personHint(e) }));

  return (
    <section className="flex flex-col gap-5">
      {error && <ErrorNote message={error} />}
      {crew.isLoading && <TableSkeleton />}

      {crew.data && crew.data.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          You're not on any jobs yet, so there's nothing to set here.
        </p>
      )}

      <div className="flex flex-col gap-6">
        {(crew.data ?? []).map((job) => (
          <div key={job.projectId} className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {job.projectName}
            </h3>

            {job.tiers.length === 0 && (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Your company hasn't drawn a reporting line above or below {job.myTeamRole} yet —
                nothing to ask here.
              </p>
            )}

            <ul className="flex flex-col gap-2">
              {job.tiers.map((tier) => {
                const pickKey = `${job.projectId}:${tier.teamRoleId}`;
                return (
                  <li key={pickKey} className="flex items-center gap-3 rounded-md border p-3">
                    {/* WORDED, not a bare arrow. This was an icon with a
                        `title` tooltip — invisible on touch, and the client
                        asked outright "what is this arrow buttons!?", which is
                        the whole argument. The glyph stays as reinforcement;
                        the words carry the meaning. */}
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-[4px] border border-border bg-muted/40 text-muted-foreground"
                      aria-hidden
                    >
                      {tier.relation === "above" ? (
                        <ArrowUp className="size-3.5" />
                      ) : (
                        <ArrowDown className="size-3.5" />
                      )}
                    </span>

                    {/* STACKED, and no `truncate`. This was one `w-40 truncate`
                        box holding both the label and the relation, which cut
                        "Area In-charge · your in-charge" to "· your in-c…" at
                        every font scale — reported from a screenshot. The
                        relation is a second line rather than a wider box
                        because widening it steals room from the picker below,
                        which is the control that actually does something. */}
                    <span className="flex w-44 shrink-0 flex-col leading-tight">
                      <span className="text-sm font-medium">{tier.label}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {tier.relation === "above"
                          ? "your in-charge"
                          : tier.hops > 1
                            ? `${tier.hops} below you`
                            : "your crew"}
                      </span>
                    </span>

                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {tier.filled.length > 0 && (
                          <ul className="flex flex-wrap gap-1.5">
                            {tier.filled.map((f) => (
                              <li
                                key={f.id}
                                className={cn(
                                  "flex items-center gap-1.5 rounded-[3px] border px-2 py-1 text-xs",
                                  f.confirmed ? "border-border bg-muted/40" : "border-primary/40 bg-accent",
                                )}
                              >
                                {f.employeeName}
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
                              </li>
                            ))}
                          </ul>
                        )}

                        {/*
                          A crew of seven is seven identical clicks otherwise.
                          Only offered when there is more than one left to do —
                          a single outstanding row already has its own button
                          inline and a second control beside it would be noise.
                        */}
                        {tier.canAssign && tier.filled.filter((f) => !f.confirmed).length > 1 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 text-xs"
                            disabled={confirm.isPending}
                            onClick={() => {
                              for (const f of tier.filled) {
                                if (!f.confirmed) confirm.mutate({ id: f.id });
                              }
                            }}
                          >
                            Confirm all
                          </Button>
                        )}

                        {/* Only meaningful while the tier is still empty — a
                            deferral resolves the moment somebody fills it. */}
                        {tier.filled.length === 0 && tier.deferred && (
                          <span className="text-xs text-muted-foreground">
                            Left for whoever names {tier.label.toLowerCase()}.
                          </span>
                        )}

                        {/* Not yours to name, and not yet handed off. Split out
                            of the old `canAssign` else-branch so the picker
                            below could become a row of its own. */}
                        {tier.filled.length === 0 && !tier.canAssign && !tier.deferred && (
                          <span className="text-xs text-muted-foreground">Not yours to name.</span>
                        )}

                        {tier.filled.length === 0 && !tier.canAssign && !tier.deferred && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 shrink-0 px-2 text-xs"
                            disabled={defer.isPending}
                            onClick={() => defer.mutate({ projectId: job.projectId, teamRole: tier.teamRoleName })}
                          >
                            My {tier.relation === "above" ? "in-charge" : "team"} will handle this
                          </Button>
                        )}

                        {/* WITHDRAW. Deferring used to be one-way: the only exit
                            was somebody filling the tier, and the picker was
                            hidden on a filled tier, so "Area Incharge, did
                            something cannot undo" was literally true. */}
                        {tier.deferred && tier.filled.length === 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 shrink-0 px-2 text-xs"
                            disabled={undefer.isPending}
                            onClick={() => undefer.mutate({ projectId: job.projectId, teamRole: tier.teamRoleName })}
                          >
                            <Undo2 className="mr-1 size-3" aria-hidden />
                            I&apos;ll name them
                          </Button>
                        )}
                      </div>

                      {/*
                        THE PICKER GETS ITS OWN ROW, and that is the whole fix
                        for the reported glitch. It used to sit inside the
                        wrapping row above with `flex-1`, sharing one line with
                        the name chips and "Confirm all" — so on a tier with two
                        people recorded it was squeezed to the width of "Ad…"
                        and its own submit button was pushed outside the card.
                        The control that actually assigns somebody was the one
                        the layout sacrificed.

                        `flex-1` inside a `flex-wrap` parent does not move the
                        item to its own line; it makes it fight for the current
                        one. Giving it a sibling row instead means its width no
                        longer depends on how many people are already named.
                      */}
                      {tier.canAssign && (
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <EntityField
                              options={employeeOptions}
                              value={picking[pickKey] ?? ""}
                              onChange={(v) => setPicking((prev) => ({ ...prev, [pickKey]: v }))}
                              placeholder={
                                tier.filled.length > 0
                                  ? `Add another ${tier.label.toLowerCase()}`
                                  : `Name a ${tier.label.toLowerCase()}`
                              }
                              searchPlaceholder="Search people…"
                            />
                          </div>
                          {/* Worded, not a bare icon: this is the button that
                              puts somebody on the job, and an icon alone left
                              the client asking how to assign a crew at all. */}
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            disabled={!picking[pickKey] || assign.isPending}
                            onClick={() =>
                              assign.mutate({
                                projectId: job.projectId,
                                employeeId: picking[pickKey]!,
                                role: tier.teamRoleName,
                                source: "onboarding",
                              })
                            }
                          >
                            <UserPlus className="mr-1.5 size-4" aria-hidden />
                            Add to {job.projectName}
                          </Button>
                        </div>
                      )}

                      {/* Advisory, never a block — the same treatment /my-crew
                          gives it. Raised only once somebody is picked, because
                          a permanent banner on every distant tier is noise. */}
                      {tier.hops > 1 && tier.skipsTiers.length > 0 && picking[pickKey] && (
                        <p className="flex items-start gap-1.5 rounded-[3px] border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span>
                            This skips {tier.skipsTiers.join(", ")} — they&apos;ll answer straight to you.
                            That&apos;s allowed.
                          </span>
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
