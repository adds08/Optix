"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EntityField, type EntityOption } from "@/components/ui/entity-picker";

/*
  A picker whose list can also CREATE the thing it is picking.

  The pattern this replaces inlined the create form into the parent, which put
  a second set of fields inside a form that was already about something else —
  "New Employee" growing a job-title editor in the middle of it. Everything the
  creation needs lives in the modal instead, and the parent gets back one id.

  THE CREATE ROW IS FIRST, not last. These lists run long (122 job titles), and
  an action pinned under all of them is only found by scrolling past every
  answer it is an alternative to.

  `onCreate` owns the write and returns the new id. This component does not
  know what it is creating — that is the point, and is what lets a location, a
  department or a division adopt it without a second copy of any of this.
*/

const CREATE = "__create__";

export function EntityFieldWithCreate({
  options,
  value,
  onChange,
  placeholder,
  emptyLabel,
  searchPlaceholder,
  disabled,
  createLabel,
  dialogTitle,
  dialogDescription,
  /* The form shown inside the modal. Rendered by the caller so the fields can
     be anything — a name, a name plus a role, a whole sub-form. It reports
     whether it currently holds enough to save. */
  children,
  canSave,
  onCreate,
  onOpenCreate,
}: {
  options: EntityOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  emptyLabel?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  createLabel: string;
  dialogTitle: string;
  dialogDescription?: string;
  children: React.ReactNode;
  canSave: boolean;
  /* Returns the id of the thing it made, which becomes the field's value. */
  onCreate: () => Promise<string>;
  /* Called when the modal opens, so the caller can clear its own form state.
     Without it a second create starts pre-filled with the first one's answer. */
  onOpenCreate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const id = await onCreate();
      onChange(id);
      setOpen(false);
    } catch (e) {
      /* Kept in the modal rather than toasted away: the fields that caused it
         are still on screen and still editable. */
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    }
    setSaving(false);
  };

  return (
    <>
      <EntityField
        options={[{ value: CREATE, label: createLabel }, ...options]}
        value={value === CREATE ? "" : value}
        onChange={(v) => {
          if (v === CREATE) {
            onOpenCreate?.();
            setError("");
            setOpen(true);
            return;
          }
          onChange(v);
        }}
        placeholder={placeholder}
        emptyLabel={emptyLabel}
        searchPlaceholder={searchPlaceholder}
        disabled={disabled}
      />
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            {dialogDescription ? <DialogDescription>{dialogDescription}</DialogDescription> : null}
          </DialogHeader>
          <div className="space-y-4">{children}</div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !canSave}>
              {saving ? "Saving…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
