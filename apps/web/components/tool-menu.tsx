"use client";

import { useState } from "react";
import {
  ArrowLeftRight,
  CornerUpLeft,
  Ellipsis,
  Loader2,
  Pencil,
  StickyNote,
  Trash2,
  UserPlus,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { AssignForm } from "@/components/assign-form";
import { TransferForm } from "@/components/transfer-form";
import { ReportForm } from "@/components/report-form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/*
  Everything you can do to one tool, behind one always-visible control.

  This replaces a strip of buttons that only appeared on hover. Hover is not a
  gesture on a tablet in a yard, and on the desk it meant the actions were
  invisible until the pointer happened to land on the right card — so the answer
  to "how do I hand this over" was "open the tool first", which is one click too
  many for the most common thing anyone does here.

  Which actions appear still follows where the tool is: nothing in the yard needs
  returning, and a tool nobody holds cannot be handed on.
*/
export function ToolMenu({
  assetId,
  assetTag,
  heldBySomeone,
  onEdit,
  onDelete,
  deleting,
}: {
  assetId: string;
  assetTag: string;
  heldBySomeone: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const [open, setOpen] = useState<"assign" | "transfer" | "report" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { has } = usePermissions();
  const utils = trpc.useUtils();

  const invalidate = () => {
    utils.asset.get.invalidate({ id: assetId });
    utils.transaction.list.invalidate({ assetId });
    utils.asset.list.invalidate();
    utils.assignment.list.invalidate();
    utils.dashboard.pendingApprovals.invalidate();
  };

  const submit = trpc.action.submit.useMutation({ onSuccess: invalidate });

  const close = () => {
    setOpen(null);
    invalidate();
  };

  const canCustody = has("assignment.create");
  const canTransfer = has("transfer.create");
  const canManage = has("asset.manage");

  return (
    <>
      <DropdownMenu
        onOpenChange={(o) => {
          /* Reset the delete confirmation whenever the menu closes, so it never
             reopens already armed. */
          if (!o) setConfirming(false);
        }}
      >
        <DropdownMenuTrigger
          aria-label={`Actions for ${assetTag}`}
          className="flex size-7 items-center justify-center rounded-md border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:bg-accent data-[state=open]:text-foreground"
          onClick={(e) => {
            /* Cards wrap their body in a link — opening the menu must not
               navigate to the tool. */
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          {submit.isPending || deleting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Ellipsis className="size-4" />
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel>{assetTag}</DropdownMenuLabel>

          {heldBySomeone ? (
            <>
              {canTransfer ? (
                <DropdownMenuItem onSelect={() => setOpen("transfer")}>
                  <ArrowLeftRight />
                  Hand over to someone
                </DropdownMenuItem>
              ) : null}
              {canCustody ? (
                <DropdownMenuItem
                  onSelect={() => submit.mutate({ type: "return", assetIds: [assetId] })}
                >
                  <CornerUpLeft />
                  Return to the yard
                </DropdownMenuItem>
              ) : null}
            </>
          ) : canCustody ? (
            <DropdownMenuItem onSelect={() => setOpen("assign")}>
              <UserPlus />
              Give it to someone
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuItem onSelect={() => setOpen("report")}>
            <StickyNote />
            Add a note
          </DropdownMenuItem>

          {canManage && (onEdit || onDelete) ? <DropdownMenuSeparator /> : null}

          {canManage && onEdit ? (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Edit details
            </DropdownMenuItem>
          ) : null}

          {canManage && onDelete ? (
            confirming ? (
              <DropdownMenuItem variant="danger" onSelect={onDelete}>
                <Trash2 />
                Really delete {assetTag}?
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                variant="danger"
                onSelect={(e) => {
                  /* Keep the menu open so the confirmation replaces this row
                     rather than appearing after a second click somewhere else. */
                  e.preventDefault();
                  setConfirming(true);
                }}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            )
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Outcome of a Return, which can come back parked for a signature. */}
      {submit.data && submit.data.outcome !== "applied" ? (
        <span className="ml-2 text-xs text-warn">Sent to the desk</span>
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
    </>
  );
}
