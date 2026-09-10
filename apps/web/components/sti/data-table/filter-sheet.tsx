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
import { useIsMobile } from "@/hooks/use-mobile";

/*
  The collapsible filter sheet every DataTable uses.

  Filters are drafted inside the sheet and committed on Apply — a keystroke in
  the sheet must not fire a refetch. The parent owns the committed filter
  state; this component only owns open/closed and the trigger badge.

  On a phone it comes up from the bottom instead of in from the right: the
  controls land under the thumb rather than across the top of the screen, and a
  side panel on a 390px viewport is just a full-screen takeover with a slide
  animation pointing the wrong way.
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
  const mobile = useIsMobile();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="default" aria-label="Open filters">
          <SlidersHorizontal className="size-3.5" />
          Filters
          {activeCount > 0 ? (
            <span className="tnum ml-1 rounded-sm bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        /* Capped short of the viewport on a phone so the list stays visible
           behind the sheet — filtering with no sight of what you are filtering
           is guesswork. */
        className={mobile ? "max-h-[85dvh] rounded-t-xl" : "w-full sm:max-w-sm"}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Commit changes to apply them to the table.</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">
          {children}
        </div>
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
