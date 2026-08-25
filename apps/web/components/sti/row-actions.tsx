"use client";

import { useState } from "react";
import { Ellipsis, Loader2, Pencil, Trash2, type LucideIcon } from "lucide-react";
import type { Permission } from "@stinventory/types";
import { usePermissions } from "@/components/use-permissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/*
  Everything you can do to a register row, behind one control.

  This was a strip of buttons — Edit, a delete bin, and whatever else the page
  needed in front of them — laid out inline in the actions cell. It did not fit.
  Each register sized its own column to whatever it happened to hold (`9rem`,
  then `14rem` on People when "Move project" arrived), and the strip still ran
  off the end: the trailing control was clipped by the cell, so on People the
  delete bin was unreachable at ordinary window widths. Widening the column is
  what was tried and it does not converge — the column is sized for the widest
  row's worst case, and every action added takes the space the table needs for
  the data people came to read.

  A menu is a fixed-width trigger no matter how many actions hang off it, which
  is the property the strip never had. `ToolMenu` reached the same conclusion
  for tools and this is deliberately the same component in miniature — same
  ellipsis trigger, same armed confirmation, same danger styling — so a row in
  the register and a row in People do not answer the same gesture differently.

  Delete asks twice, and the server asks harder: the routers refuse to remove
  anything carrying history and say what to do instead (dispose, terminate,
  complete). That refusal is surfaced rather than swallowed — "you can't, and
  here is why" is more useful than a button that silently fails.
*/

export type RowAction = {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Falls back to the row's `perm` when the action needs no separate right. */
  perm?: Permission;
};

export function RowActions({
  perm,
  label,
  onEdit,
  onDelete,
  deleting,
  error,
  actions = [],
}: {
  perm: Permission;
  /** What is being acted on, for the menu heading and the confirmation. */
  label: string;
  onEdit?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  error?: string | null;
  /*
    Register-specific actions — "Move project" — listed above Edit.

    Declarative rather than a `ReactNode`, which is what it used to take. The
    caller passing rendered buttons is why every page styled its own and why
    they could not be moved into a menu without editing all of them: JSX can be
    placed somewhere else, but it cannot be turned into a menu item. A shape the
    component owns can be rendered however this file decides, and the permission
    gate stops being something each caller remembers to wrap around its button.
  */
  actions?: RowAction[];
}) {
  /* Armed confirmation, reset whenever the menu closes so it can never reopen
     already armed and delete on a stray click. */
  const [confirming, setConfirming] = useState(false);
  const { has } = usePermissions();

  const allowed = actions.filter((a) => has(a.perm ?? perm));
  const canManage = has(perm);
  const showEdit = canManage && !!onEdit;
  const showDelete = canManage && !!onDelete;

  /* No rights, no actions, no trigger. An ellipsis that opens an empty menu is
     worse than no ellipsis — it advertises something that is not there. */
  if (!allowed.length && !showEdit && !showDelete) {
    return error ? <ErrorNote error={error} /> : null;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu onOpenChange={(o) => !o && setConfirming(false)}>
        <DropdownMenuTrigger
          aria-label={`Actions for ${label}`}
          className="flex size-7 items-center justify-center rounded-md border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          {deleting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Ellipsis className="size-4" />
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{label}</DropdownMenuLabel>

          {allowed.map((a) => (
            <DropdownMenuItem key={a.label} onSelect={a.onSelect}>
              <a.icon />
              {a.label}
            </DropdownMenuItem>
          ))}

          {allowed.length && (showEdit || showDelete) ? <DropdownMenuSeparator /> : null}

          {showEdit ? (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Edit details
            </DropdownMenuItem>
          ) : null}

          {showDelete ? (
            confirming ? (
              <DropdownMenuItem variant="danger" onSelect={onDelete}>
                <Trash2 />
                Really delete {label}?
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

      {error ? <ErrorNote error={error} /> : null}
    </div>
  );
}

/* Kept in the cell rather than inside the menu: a refusal arrives after the
   menu has closed, and a message nobody is looking at explains nothing. Narrow
   and wrapping, because the column this sits in is now a trigger wide. */
function ErrorNote({ error }: { error: string }) {
  return <span className="max-w-[14rem] text-right text-xs text-balance text-crit">{error}</span>;
}
