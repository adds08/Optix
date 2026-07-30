"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { AssignForm } from "@/components/assign-form";
import { TransferForm } from "@/components/transfer-form";
import { ReportForm } from "@/components/report-form";

/*
  Custody actions for one tool, on the desk side.

  Which actions are offered follows where the tool actually is — nothing in the
  yard needs returning, and a tool nobody holds cannot be transferred. Same rule
  the mobile tool screen uses, so the two surfaces never disagree about what is
  possible.

  Return goes through `action.submit` rather than a dialog: there is nothing to
  ask. The other three need fields, so they open their existing form.
*/
export function AssetActions({
  assetId,
  assetTag,
  heldBySomeone,
}: {
  assetId: string;
  assetTag: string;
  heldBySomeone: boolean;
}) {
  const [open, setOpen] = useState<"assign" | "transfer" | "report" | null>(null);
  const utils = trpc.useUtils();

  const invalidate = () => {
    utils.asset.get.invalidate({ id: assetId });
    utils.transaction.list.invalidate({ assetId });
    utils.asset.list.invalidate();
    utils.assignment.list.invalidate();
  };

  /* Return can also come back parked — returning a tool takes it out of
     somebody's hands, which is a custody change like any other. Saying nothing
     on success meant the row simply did not change and the button looked dead. */
  const submit = trpc.action.submit.useMutation({
    onSuccess: () => {
      invalidate();
      utils.dashboard.pendingApprovals.invalidate();
    },
  });

  const close = () => {
    setOpen(null);
    invalidate();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {heldBySomeone ? (
        <>
          <Can perm="transfer.create">
            <Button size="sm" variant="outline" onClick={() => setOpen("transfer")}>
              Transfer
            </Button>
          </Can>
          <Can perm="assignment.create">
            <Button
              size="sm"
              variant="outline"
              disabled={submit.isPending}
              onClick={() => submit.mutate({ type: "return", assetIds: [assetId] })}
            >
              {submit.isPending ? "Returning…" : "Return"}
            </Button>
          </Can>
        </>
      ) : (
        <Can perm="assignment.create">
          <Button size="sm" variant="outline" onClick={() => setOpen("assign")}>
            Assign
          </Button>
        </Can>
      )}

      <Button size="sm" variant="outline" onClick={() => setOpen("report")}>
        Add note
      </Button>

      {submit.isError ? (
        <span className="text-sm text-destructive">{submit.error.message}</span>
      ) : submit.data && submit.data.outcome !== "applied" ? (
        <span className="text-sm text-warn">
          {submit.data.outcome === "awaiting_approval"
            ? "Sent to the desk for a second signature — the tool has not moved yet."
            : "Sent as a request. The desk makes this change."}
        </span>
      ) : null}

      {open === "assign" ? (
        <AssignForm open onClose={close} preselectedAssetId={assetId} />
      ) : null}
      {open === "transfer" ? (
        <TransferForm open onClose={close} assetId={assetId} assetTag={assetTag} />
      ) : null}
      {open === "report" ? (
        <ReportForm open onClose={close} assetId={assetId} assetTag={assetTag} />
      ) : null}
    </div>
  );
}
