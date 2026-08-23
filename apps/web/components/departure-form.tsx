"use client";

import { useState } from "react";
import { UserMinus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote } from "@/components/sti/page";

/*
  Somebody has left, and the register still has their name on nineteen tools.

  The clearance queue has always been able to say that and nothing more, so the
  only way to act on it was the assignment form, one tool at a time — which is
  how a mistake becomes forty ledger events that cannot be edited afterwards.
  Hence the shape of this screen: NOTHING is written until the operator has
  seen the exact list. The preview is a query; the confirm is the only mutation.

  Two things it is deliberate about:

  - The successor is proposed from the project team, never invented. Where the
    team yields nobody the confirm stays disabled until a person is picked —
    leaving the tools with the leaver and guessing a holder are both wrong, and
    the second one is worse because it looks like it worked.
  - Personal vehicles appear in their own list with the reason spelled out.
    "Why is his truck not moving" has to be answerable on the screen.

  Closing the leaver's login is NOT part of this (STI-303). Custody and
  accounts are separate decisions.
*/

const selectClass =
  "flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function DepartureForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const employees = trpc.employee.list.useQuery();

  const [leaverId, setLeaverId] = useState("");
  const [successorId, setSuccessorId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const preview = trpc.departure.preview.useQuery(
    { leaverEmployeeId: leaverId, successorEmployeeId: successorId || undefined },
    { enabled: !!leaverId },
  );

  /* Only people who have actually left. Reassigning an active employee's tools
     is a transfer, and there is a form for that. */
  const leavers = (employees.data ?? []).filter((e) => e.employmentStatus === "terminated");
  /* And only active people can receive them — offering a terminated one here
     is how the queue entry this action clears comes straight back. */
  const receivers = (employees.data ?? []).filter((e) => e.employmentStatus === "active" && e.id !== leaverId);

  const p = preview.data;
  const blocked = !!p?.successorRequired && !successorId;
  const nothingToMove = !!p && p.tools.length === 0 && p.containers.length === 0;

  const close = () => {
    setLeaverId("");
    setSuccessorId("");
    setNote("");
    setError("");
    setDone(null);
    onClose();
  };

  /*
    A mutation hook rather than `utils.client.…mutate` in a try/catch, for the
    error path: the catch had `err.message`, which the STI-204 formatter
    redacts to a generic line for anything internal — so a coded refusal
    written for this screen ("Nobody active was found above them…") arrived
    with its text stripped. `data.userMessage` is the formatter's contract:
    non-null exactly when the text was meant to be read by a person.
  */
  const reassign = trpc.departure.reassign.useMutation({
    onSuccess: (result) => {
      /* Everything that reads "who holds what" is now wrong on screen — the
         queue this was opened from most of all. */
      utils.dashboard.clearanceQueue.invalidate();
      utils.dashboard.kpis.invalidate();
      utils.asset.list.invalidate();
      utils.assignment.list.invalidate();
      utils.location.list.invalidate();
      utils.vehicle.list.invalidate();
      utils.report.byForeman.invalidate();
      setDone(
        `${result.tools.length} ${result.tools.length === 1 ? "tool" : "tools"} and ${result.containers.length} ${
          result.containers.length === 1 ? "container" : "containers"
        } moved to ${result.successor.name}` +
          (result.containerToolsMoved
            ? `, plus ${result.containerToolsMoved} ${
                result.containerToolsMoved === 1 ? "tool that was" : "tools that were"
              } inside them.`
            : "."),
      );
    },
    onError: (e) =>
      setError(e.data?.userMessage ?? "Could not reassign. Nothing was moved."),
  });

  const submit = () => {
    setError("");
    reassign.mutate({
      leaverEmployeeId: leaverId,
      successorEmployeeId: successorId || undefined,
      note: note || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Clear a departure</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="space-y-3">
            <p className="text-sm">{done}</p>
            <p className="text-xs text-muted-foreground">
              Their login is untouched — closing an account is a separate decision.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Who has left</label>
              <select value={leaverId} onChange={(e) => { setLeaverId(e.target.value); setSuccessorId(""); }} className={selectClass}>
                <option value="">Pick a terminated employee</option>
                {leavers.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.primaryProjectName ? ` — ${e.primaryProjectName}` : ""}
                  </option>
                ))}
              </select>
              {leavers.length === 0 && !employees.isLoading ? (
                <p className="text-xs text-muted-foreground">Nobody is marked terminated right now.</p>
              ) : null}
            </div>

            {leaverId ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Who takes it on</label>
                <select value={successorId} onChange={(e) => setSuccessorId(e.target.value)} className={selectClass}>
                  <option value="">
                    {p?.successor && p.successor.source === "team"
                      ? `${p.successor.name} — from the project team`
                      : "Pick who takes the tools"}
                  </option>
                  {receivers.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.role ? ` — ${e.role}` : ""}
                    </option>
                  ))}
                </select>
                {blocked ? (
                  <p className="text-sm text-destructive">
                    Nobody active was found on the project team. Choose who takes the tools — this
                    will not be guessed.
                  </p>
                ) : null}
              </div>
            ) : null}

            {preview.isLoading && leaverId ? <p className="text-sm text-muted-foreground">Working out what moves…</p> : null}

            {/* The preview REFUSES for a leaver who is not terminated, for one
                who is not in this tenant, and for a chosen successor who has
                left — all of them written to be read. Rendering only
                `isLoading` and `data` meant every one of those arrived as a
                blank dialog: the spinner stopped and nothing replaced it, so
                the operator's only signal was a button that did nothing.
                Same STI-204 contract as the confirm above. */}
            {preview.error ? (
              <ErrorNote
                message={
                  preview.error.data?.userMessage ??
                  "That departure could not be worked out. Try again, or ask the equipment desk."
                }
              />
            ) : null}

            {p ? (
              <div className="space-y-3">
                <MoveList
                  title={`Tools moving (${p.tools.length})`}
                  empty="No tool is on their name."
                  rows={p.tools.map((t) => ({
                    key: t.assetId,
                    left: t.tag ?? "—",
                    mid: t.modelName ?? "Untagged tool",
                    right: t.status ?? "",
                  }))}
                />
                <MoveList
                  title={`Trailers, trucks and boxes moving (${p.containers.length})`}
                  empty="They are not holding a container."
                  rows={p.containers.map((c) => ({
                    key: c.locationId,
                    left: c.unit ?? c.locationName,
                    mid: c.vehicleType ?? "container",
                    right: "",
                  }))}
                />
                {p.containers.length ? (
                  /* The preview lists what the LEAVER holds. A container also
                     takes whatever is inside it — an unheld tool in the
                     trailer, or one on somebody else's name — and that is the
                     same rule the container screen follows. Said here because
                     the list above cannot enumerate it. */
                  <p className="text-xs text-muted-foreground">
                    Anything else sitting in these containers moves with them, the same as handing a trailer over.
                  </p>
                ) : null}
                {p.skipped.length ? (
                  <div className="rounded-md border border-warn/50 p-3">
                    <p className="text-sm font-medium">Staying with them ({p.skipped.length})</p>
                    <ul className="mt-1.5 space-y-1">
                      {p.skipped.map((c) => (
                        <li key={c.locationId} className="text-xs text-muted-foreground">
                          {c.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-sm font-medium">Note</label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Last day Friday — tools collected at the yard"
              />
              <p className="text-xs text-muted-foreground">
                Goes on every ledger entry this writes. Left blank, it records the departure by name.
              </p>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {done ? "Done" : "Cancel"}
          </Button>
          {done ? null : (
            <Button onClick={submit} disabled={reassign.isPending || !leaverId || blocked || nothingToMove || preview.isLoading || !!preview.error}>
              {reassign.isPending ? "…" : `Move it all${p?.successor ? ` to ${(successorId && receivers.find((r) => r.id === successorId)?.name) || p.successor.name}` : ""}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: { key: string; left: string; mid: string; right: string }[];
}) {
  return (
    <div className="rounded-md border">
      <p className="border-b px-3 py-2 text-sm font-medium">{title}</p>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="max-h-48 overflow-y-auto">
          {rows.slice(0, 50).map((r) => (
            <li key={r.key} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <span className="label-xs w-24 shrink-0 text-foreground">{r.left}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.mid}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{r.right}</span>
            </li>
          ))}
          {rows.length > 50 ? (
            <li className="px-3 py-1.5 text-xs text-muted-foreground">…and {rows.length - 50} more, all of them included.</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

/*
  The way in from the clearance queue, which until now dead-ended: it could
  name the ex-employee still holding a tool and offered nothing to press.
*/
export function DepartureReassignButton() {
  const { has } = usePermissions();
  const [open, setOpen] = useState(false);
  if (!has("custody.reassign")) return null;
  return (
    <>
      <Button variant="outline" size="sm" className="mt-1 w-fit" onClick={() => setOpen(true)}>
        <UserMinus className="size-3.5" /> Clear a departure
      </Button>
      <DepartureForm open={open} onClose={() => setOpen(false)} />
    </>
  );
}
