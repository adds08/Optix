"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Permission } from "@stinventory/types";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";

/*
  The "New X" control that every register page hangs off its PageHeader.

  All the create dialogs share one prop shape — `{ open, onClose }` — so the
  button, its permission gate and the dialog wiring live here once instead of
  being retyped on every list page. Permission is checked twice on purpose:
  `Can` hides the button, and the tRPC procedure behind the form refuses the
  call. Hiding a control is presentation, not access control.
*/
export function CreateAction({
  perm,
  label,
  Form,
}: {
  perm: Permission;
  label: string;
  Form: React.ComponentType<{ open: boolean; onClose: () => void }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Can perm={perm}>
      {/* default (34px) — the toolbar standard, so Import / New / Export /
          Saved filters all sit level with the search field beside them. */}
      <Button size="default" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden />
        {label}
      </Button>
      {/* Mounted only while open so each run starts with empty fields. */}
      {open ? <Form open={open} onClose={() => setOpen(false)} /> : null}
    </Can>
  );
}
