"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { EntityField } from "@/components/ui/entity-picker";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";
import { cn } from "@/lib/utils";

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
  const defer = trpc.onboarding.defer.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });

  const employeeOptions = (employees.data ?? [])
    .filter((e) => e.employmentStatus === "active")
    .map((e) => ({ value: e.id, label: e.name, hint: e.externalId ?? undefined }));

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
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-[4px] border border-border bg-muted/40 text-muted-foreground"
                      title={tier.relation === "above" ? "Reports up to you" : "Reports to you"}
                    >
                      {tier.relation === "above" ? (
                        <ArrowUp className="size-3.5" aria-hidden />
                      ) : (
                        <ArrowDown className="size-3.5" aria-hidden />
                      )}
                    </span>

                    <span className="w-32 shrink-0 truncate text-sm font-medium">{tier.label}</span>

                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {tier.filled.length > 0 ? (
                        <>
                          <ul className="flex flex-1 flex-wrap gap-1.5">
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
                        </>
                      ) : tier.deferred ? (
                        <span className="flex-1 text-xs text-muted-foreground">
                          Left for whoever names {tier.label.toLowerCase()}.
                        </span>
                      ) : tier.canAssign ? (
                        <div className="flex flex-1 items-center gap-2">
                          <EntityField
                            options={employeeOptions}
                            value={picking[pickKey] ?? ""}
                            onChange={(v) => setPicking((prev) => ({ ...prev, [pickKey]: v }))}
                            placeholder={`Name a ${tier.label.toLowerCase()}`}
                            searchPlaceholder="Search people…"
                          />
                          <Button
                            size="sm"
                            variant="outline"
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
                            <UserPlus className="size-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-1 items-center gap-2">
                          <span className="text-xs text-muted-foreground">Not yours to name.</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            disabled={defer.isPending}
                            onClick={() => defer.mutate({ projectId: job.projectId, teamRole: tier.teamRoleName })}
                          >
                            My {tier.relation === "above" ? "boss" : "team"} will handle this
                          </Button>
                        </div>
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
