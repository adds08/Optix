"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityField } from "@/components/ui/entity-picker";
import { projectHint } from "@/lib/format";

/*
  Put a person on a job, in a NAMED TIER — the seating path the product did not
  have.

  Why this exists, and why it is not `PostingForm` next door. Every other way to
  write a roster row could only ever write three of them:

    - the jobsite hub's team strip types its members `"pm" | "superintendent"`
    - its crew rows and `rig-picker` hardcode `"foreman"`
    - `employee.assignToProject` (what `PostingForm` calls) takes no tier at
      all: it infers one from `TEAM_ROLE_FROM_EMPLOYEE`, which is those same
      three names, and for anybody else writes **no roster row at all, and
      says nothing** (`project-assign.ts` — `teamRole` falls to `undefined`
      and the insert is skipped)
    - `/my-crew` and the onboarding crew step handle any tier correctly, but
      both read the caller's OWN jobs, so they can only add to a job the
      caller is already on

  So a tenant tier — Director, Area In-charge, General Superintendent — could be
  created on the Team Roles screen, could be given assign authority by "Set by"
  (STI-503), and still could not be given to a single human being on a single
  job. The authority was real and unreachable. Reported directly on 2026-09-09
  as "how do I assign crew to project?", after the roster was cleared and the
  onboarding wizard consequently had nothing to show anybody.

  It writes through `projectTeam.assign`, the same chokepoint the jobsite hub
  uses — so `assertCanAssign` still gates it, a custody-holding tier still
  routes through `moveEmployeeToProject` and takes its tools along, and this
  dialog invents no elevated path. The only thing it adds is the ability to
  SAY which tier.
*/
export function PutOnJobForm({
  open,
  onClose,
  employeeId,
  employeeName,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
}) {
  const utils = trpc.useUtils();
  const projects = trpc.project.list.useQuery();
  /* The tenant's own register, not a hardcoded list — the whole point. */
  const tiers = trpc.projectTeam.roles.list.useQuery();

  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState("");
  const [startedOn, setStartedOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [moveTools, setMoveTools] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const chosenTier = (tiers.data ?? []).find((t) => t.name === role);

  const submit = async () => {
    if (!projectId || !role) return;
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.projectTeam.assign.mutate({
        projectId,
        employeeId,
        role,
        startedOn,
        note: note || undefined,
        /* Only meaningful for a tier that holds custody; ignored otherwise by
           the procedure itself, so it is safe to always send. */
        moveTools,
        source: "manual_entry",
      });
      utils.projectTeam.all.invalidate();
      utils.employee.list.invalidate();
      utils.employee.get.invalidate({ id: employeeId });
      utils.employee.postings.invalidate({ employeeId });
      /* The wizard and /my-crew both read the roster this just wrote — without
         these, seating somebody leaves their own onboarding still saying they
         are on no jobs until a reload. */
      utils.onboarding.crewStatus.invalidate();
      utils.onboarding.state.invalidate();
      onClose();
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Could not save. Try again.");
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Put {employeeName} on a job</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Job *</label>
            <EntityField
              value={projectId}
              onChange={setProjectId}
              placeholder="Select…"
              searchPlaceholder="Job name or code"
              emptyLabel="No job matches."
              options={(projects.data ?? []).map((p) => ({
                value: p.id,
                label: p.name,
                hint: projectHint(p),
              }))}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Tier on this job *</label>
            <EntityField
              value={role}
              onChange={setRole}
              placeholder="Select…"
              searchPlaceholder="Search tiers…"
              emptyLabel="No tier matches."
              options={(tiers.data ?? []).map((t) => ({ value: t.name, label: t.label }))}
            />
            <p className="text-xs text-muted-foreground">
              Every tier your organization has defined, from Settings → Team roles — not just
              PM, superintendent and foreman.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Starting</label>
            <Input type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          </div>

          {/* Shown only when it can actually do something. A Director does not
              carry a trailer, and a checkbox about tools on that row would be
              a question with no meaning. */}
          {chosenTier?.canHoldCustody && (
            <label className="flex items-start gap-2.5 rounded-md border p-3">
              <input
                type="checkbox"
                checked={moveTools}
                onChange={(e) => setMoveTools(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span className="text-sm">
                Move everything they are holding to this job
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  This tier holds tools and a truck, so they travel with the person by default.
                  When unticked, directly held tools are released on their previous job.
                </span>
              </span>
            </label>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Note</label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Running the water package on this one"
            />
          </div>

          {result && <p className="text-sm text-destructive">{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !projectId || !role}>
            {submitting ? "…" : "Put on job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
