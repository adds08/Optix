"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { Permission } from "@stinventory/types";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";

/*
  Edit and delete on a register row.

  Every list page had create-only forms and no way back into a record, so a
  mistyped tag was permanent and the only way to act on a tool was to open its
  detail page. This is the missing half, in one place so the five registers
  cannot drift apart in how they behave.

  Delete asks first, and the server asks harder — the routers refuse to remove
  anything carrying history and say what to do instead (dispose, terminate,
  complete). That refusal is shown as-is rather than swallowed: "you can't, and
  here is why" is more useful than a button that silently fails.
*/
export function RowActions({
  perm,
  label,
  onEdit,
  onDelete,
  deleting,
  error,
  extra,
}: {
  perm: Permission;
  /** What is being deleted, for the confirmation: "UIC-1012". */
  label: string;
  onEdit?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  error?: string | null;
  /** Register-specific buttons — Assign, Hand over — placed before Edit. */
  extra?: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        {extra}
        <Can perm={perm}>
          {onEdit ? (
            <Button size="sm" variant="outline" onClick={onEdit} aria-label={`Edit ${label}`}>
              <Pencil className="size-3.5" aria-hidden />
              Edit
            </Button>
          ) : null}
          {onDelete ? (
            confirming ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                >
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deleting}
                  onClick={() => {
                    onDelete();
                    setConfirming(false);
                  }}
                >
                  {deleting ? "…" : "Delete"}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirming(true)}
                aria-label={`Delete ${label}`}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            )
          ) : null}
        </Can>
      </div>
      {error ? <span className="max-w-[46ch] text-right text-xs text-crit">{error}</span> : null}
    </div>
  );
}
