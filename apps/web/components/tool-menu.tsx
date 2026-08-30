"use client";

import { useState } from "react";
import {
  ArrowLeftRight,
  BadgeCheck,
  CornerUpLeft,
  Loader2,
  Pencil,
  StickyNote,
  Tag as TagIcon,
  Pin,
  PinOff,
  Trash2,
  UserPlus,
  Wrench,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { AssignForm } from "@/components/assign-form";
import { TransferForm } from "@/components/transfer-form";
import { ReportForm } from "@/components/report-form";
import { Button } from "@/components/ui/button";
import { ActionMenuTrigger } from "@/components/sti/action-menu";
import { useRowTableOptions } from "@/components/sti/data-table/row-context";
import { humanize } from "@/components/sti/status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  const [open, setOpen] = useState<"assign" | "transfer" | "report" | "status" | null>(null);
  /* Armed confirmation — "Return to the yard" and "Delete" both need a second
     deliberate click. */
  const [confirming, setConfirming] = useState<"return" | "delete" | null>(null);
  const { has } = usePermissions();
  /* Null on the cards and on any table that does not pin. See `row-context.tsx`. */
  const table = useRowTableOptions();
  const utils = trpc.useUtils();

  const invalidate = () => {
    utils.asset.get.invalidate({ id: assetId });
    utils.transaction.list.invalidate({ assetId });
    utils.asset.list.invalidate();
    utils.assignment.list.invalidate();
    utils.dashboard.pendingApprovals.invalidate();
  };

  const submit = trpc.action.submit.useMutation({ onSuccess: invalidate });
  const setStatus = trpc.asset.setStatus.useMutation({ onSuccess: invalidate });

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
          /* Reset any armed confirmation whenever the menu closes, so it never
             reopens already armed. */
          if (!o) setConfirming(null);
        }}
      >
        <ActionMenuTrigger
          label={assetTag}
          busy={
            submit.isPending || deleting ? <Loader2 className="size-3.5 animate-spin" /> : undefined
          }
          onClick={(e) => {
            /* Cards wrap their body in a link — opening the menu must not
               navigate to the tool. */
            e.stopPropagation();
            e.preventDefault();
          }}
        />

        <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel>{assetTag}</DropdownMenuLabel>

          {/* Two groups and no more — the same split as `RowActions`, and the
              reasoning is written out there. Everything above the Table heading
              changes the TOOL; everything below changes the view of the table it
              is sitting in. The heading only appears when there is a second
              group to tell this one apart from: on a card, this menu is all
              there is. */}
          {table ? <DropdownMenuLabel className="text-muted-foreground">Actions</DropdownMenuLabel> : null}

          {heldBySomeone ? (
            <>
              {canTransfer ? (
                <DropdownMenuItem onSelect={() => setOpen("transfer")}>
                  <ArrowLeftRight />
                  Hand over to someone
                </DropdownMenuItem>
              ) : null}
              {canCustody ? (
                confirming === "return" ? (
                  <DropdownMenuItem
                    variant="danger"
                    onSelect={() => submit.mutate({ type: "return", assetIds: [assetId] })}
                  >
                    <CornerUpLeft />
                    Really return {assetTag} to the yard?
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      /* Keep the menu open so the confirmation replaces this
                         row rather than closing first. */
                      e.preventDefault();
                      setConfirming("return");
                    }}
                  >
                    <CornerUpLeft />
                    Return to the yard
                  </DropdownMenuItem>
                )
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

          {canManage ? (
            /* No rule above this: "change status" is one more thing you do to
               the tool, and fencing it off on its own put three separators in a
               six-item menu. The only division inside this group that has ever
               carried meaning is the one before the destructive pair. */
            <DropdownMenuItem onSelect={() => setOpen("status")}>
              <TagIcon />
              Change status
            </DropdownMenuItem>
          ) : null}

          {canManage && (onEdit || onDelete) ? <DropdownMenuSeparator /> : null}

          {canManage && onEdit ? (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Edit details
            </DropdownMenuItem>
          ) : null}

          {canManage && onDelete ? (
            confirming === "delete" ? (
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
                  setConfirming("delete");
                }}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            )
          ) : null}

          {table ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground">Table</DropdownMenuLabel>
              <DropdownMenuItem onSelect={table.togglePinned}>
                {table.pinned ? <PinOff /> : <Pin />}
                {table.pinned ? "Unfreeze this row" : "Freeze this row"}
              </DropdownMenuItem>
            </>
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

      {/* Change status — a held tool is never "available" (that means unheld in
         the yard; freeing it is Return instead), so the option only appears
         for tools nobody is holding. */}
      {open === "status" ? (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle>Change status of {assetTag}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-1.5">
              {(heldBySomeone ? ["reserved", "in_maintenance", "lost"] : ["available", "reserved", "in_maintenance", "lost"]).map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={setStatus.isPending}
                    onClick={() => {
                      setStatus.mutate({ id: assetId, status: s });
                      setOpen(null);
                    }}
                    className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                  >
                    {s === "in_maintenance" ? <Wrench className="size-4 text-warn" /> : s === "lost" ? <Trash2 className="size-4 text-crit" /> : s === "reserved" ? <BadgeCheck className="size-4 text-ok" /> : <TagIcon className="size-4 text-muted-foreground" />}
                    <span className="font-medium">{humanize(s)}</span>
                  </button>
                ),
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
