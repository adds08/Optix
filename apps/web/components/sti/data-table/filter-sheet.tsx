"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

/*
  The collapsible filter sheet every DataTable uses.

  Filters are drafted inside the sheet and committed on Apply — a keystroke in
  the sheet must not fire a refetch. The parent owns the committed filter
  state; this component only owns open/closed and the trigger badge.
*/
export function FilterSheet({
  title = "Filters",
  activeCount = 0,
  onApply,
  onClear,
  children,
}: {
  title?: string;
  activeCount?: number;
  onApply: () => void;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Open filters">
          <SlidersHorizontal className="size-4" />
          Filters
          {activeCount > 0 ? (
            <span className="tnum ml-1 rounded-sm bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Commit changes to apply them to the table.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto py-4">{children}</div>
        <SheetFooter className="flex-row justify-between gap-2">
          {onClear ? (
            <Button variant="outline" onClick={() => { onClear(); setOpen(false); }}>
              Clear
            </Button>
          ) : <span />}
          <Button onClick={() => { onApply(); setOpen(false); }}>Apply</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
