"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityField } from "@/components/ui/entity-picker";

/*
  Hand a trailer, truck or gang box to a foreman — or take it back.

  This is how tools actually change hands in the yard. Nobody checks out forty
  items one at a time; they hitch up a trailer and drive off. So the contents
  move with the container by default, which is both what physically happens and
  what keeps "who has UIC-1012?" answerable the next morning.

  Unassigning is the same control with nobody selected: the container becomes a
  place again and everything in it goes back to being available stock.
*/
export function ContainerCustodyForm({
  open,
  onClose,
  locationId,
  locationName,
  currentCustodianId,
  currentCustodianName,
  toolCount,
}: {
  open: boolean;
  onClose: () => void;
  locationId: string;
  locationName: string;
  currentCustodianId?: string | null;
  currentCustodianName?: string | null;
  toolCount: number;
}) {
  const utils = trpc.useUtils();
  const employees = trpc.employee.list.useQuery();

  const [custodianId, setCustodianId] = useState(currentCustodianId ?? "");
  const [moveContents, setMoveContents] = useState(true);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  /* Terminated staff cannot take custody of anything — offering them here is
     how tools end up assigned to people who have left. */
  const people = (employees.data ?? []).filter((e) => e.employmentStatus === "active");

  const unassigning = !custodianId;
  const changed = (custodianId || null) !== (currentCustodianId ?? null);

  const submit = async () => {
    setSubmitting(true);
    setResult("");
    try {
      await utils.client.location.setCustodian.mutate({
        locationId,
        custodianEmployeeId: custodianId || null,
        moveContents,
        note: note || undefined,
      });
      utils.location.list.invalidate();
      utils.vehicle.list.invalidate();
      utils.asset.list.invalidate();
      utils.assignment.list.invalidate();
      utils.report.byForeman.invalidate();
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
          <DialogTitle>Who has {locationName}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Held by</label>
            <EntityField
              value={custodianId}
              onChange={setCustodianId}
              placeholder="Nobody — back in the yard"
              searchPlaceholder="Name or employee number"
              emptyLabel="Nobody matches."
              options={people.map((e) => ({ value: e.id, label: e.name, hint: e.primaryProjectName ?? undefined }))}
            />
            {currentCustodianName ? (
              <p className="text-xs text-muted-foreground">
                Currently with {currentCustodianName}.
              </p>
            ) : null}
          </div>

          {toolCount > 0 ? (
            <label className="flex items-start gap-2.5 rounded-md border p-3">
              <input
                type="checkbox"
                checked={moveContents}
                onChange={(e) => setMoveContents(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span className="text-sm">
                Move the {toolCount} {toolCount === 1 ? "tool" : "tools"} inside it too
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {unassigning
                    ? "They go back to available stock. Untick to leave them assigned where they are."
                    : "They are physically in it, so they change hands with it. Untick only if the contents were already moved separately."}
                </span>
              </span>
            </label>
          ) : (
            <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
              Nothing is recorded as being inside {locationName} right now.
            </p>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Note</label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Swapped at the yard Monday morning"
            />
          </div>

          {result && <p className="text-sm text-destructive">{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !changed}>
            {submitting ? "..." : unassigning ? "Take it back" : "Hand it over"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
