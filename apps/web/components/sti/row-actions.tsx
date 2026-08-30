"use client";

import { useState } from "react";
import { Loader2, Pencil, Pin, PinOff, Trash2, type LucideIcon } from "lucide-react";
import type { Permission } from "@stinventory/types";
import { usePermissions } from "@/components/use-permissions";
import { ActionMenuTrigger } from "@/components/sti/action-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useRowTableOptions } from "@/components/sti/data-table/row-context";

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
  for tools and this is deliberately the same component in miniature — shared
  `ActionMenuTrigger`, same armed confirmation, same danger styling — so a row
  in the register and a row in People do not answer the same gesture
  differently.

  Delete asks twice, and the server asks harder: the routers refuse to remove
  anything carrying history and say what to do instead (dispose, terminate,
  complete). That refusal is surfaced rather than swallowed — "you can't, and
  here is why" is more useful than a button that silently fails.

  ## Two groups, and only two

  Everything in here answers one of two questions: what do I want to do to this
  THING, or how do I want to look at this TABLE. Moving a person to a job,
  editing them and deleting them are all the first; freezing their row so it
  stays put while you scan the rest is the second — it changes nothing about the
  person and everything about the view.

  So the menu is split once, under two headings, and not again. Sub-grouping the
  entity actions further ("custody", "account", "danger") was considered and is
  not here: a menu that fits on a screen without scrolling does not need a table
  of contents, and every extra rule is one more thing between a pointer and the
  item it came for. The delete confirmation already carries its own weight
  visually, which is the only distinction that has ever mattered inside the
  group.
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
  /* Null on the hand-rolled tables, which do not pin. See `row-context.tsx`. */
  const table = useRowTableOptions();

  const allowed = actions.filter((a) => has(a.perm ?? perm));
  const canManage = has(perm);
  const showEdit = canManage && !!onEdit;
  const showDelete = canManage && !!onDelete;

  /* No rights, no actions, no trigger. An ellipsis that opens an empty menu is
     worse than no ellipsis — it advertises something that is not there. */
  if (!allowed.length && !showEdit && !showDelete && !table) {
    return error ? <RefusalNote error={error} /> : null;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu onOpenChange={(o) => !o && setConfirming(false)}>
        <ActionMenuTrigger
          label={label}
          busy={deleting ? <Loader2 className="size-3.5 animate-spin" /> : undefined}
        />

        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{label}</DropdownMenuLabel>

          {/* The heading only earns its place when there is a second group to
              tell this one apart FROM. On a table with no freezing, this is the
              whole menu and a label saying so is noise. */}
          {table ? <DropdownMenuLabel className="text-muted-foreground">Actions</DropdownMenuLabel> : null}

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

      {error ? <RefusalNote error={error} /> : null}
    </div>
  );
}

/* Named for what it carries, and NOT the page-level `ErrorNote` in `sti/page`:
   that one is a full-width banner for "this screen failed to load". This is the
   server refusing one delete, in a table cell.

   Kept in the cell rather than inside the menu: a refusal arrives after the
   menu has closed, and a message nobody is looking at explains nothing. Narrow
   and wrapping, because the column this sits in is now a trigger wide. */
function RefusalNote({ error }: { error: string }) {
  return <span className="max-w-[14rem] text-right text-xs text-balance text-crit">{error}</span>;
}
