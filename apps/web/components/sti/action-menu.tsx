"use client";

import { EllipsisVertical } from "lucide-react";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
  The "actions for this row" control, in one place.

  There were four of these and three different controls. `ToolMenu` and
  `RowActions` drew a horizontal `Ellipsis` from hand-written classes;
  `JobsiteCrewCard` and the jobsites page drew a vertical one from `Button`,
  at two different sizes. Same gesture, same meaning, three answers — and the
  hand-written pair had drifted furthest, because copying the classes was
  easier than extracting them.

  Vertical, not horizontal, and that is not only taste: `MoreHorizontal`
  already means "there are hidden items here" in `ui/breadcrumb.tsx`, so
  reserving the horizontal glyph for truncation leaves the vertical one free to
  mean "act on this thing". It is also what "three dot menu" refers to
  everywhere else.

  Built on `Button` rather than styling `DropdownMenuTrigger` directly, so the
  focus ring, the disabled state and the press animation come from the same
  primitive as every other control. The one thing added on top is
  `data-[state=open]`: the trigger stays lit while its menu is open, which the
  bare `Button` has no way to know about.
*/
export function ActionMenuTrigger({
  label,
  busy,
  className,
  ...rest
}: {
  /** What the menu acts on — becomes "Actions for <label>" for screen readers. */
  label: string;
  /** Swap the glyph for a spinner while the row's action is in flight. */
  busy?: React.ReactNode;
  className?: string;
} & React.ComponentProps<typeof Button>) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        variant="outline"
        size="icon"
        aria-label={`Actions for ${label}`}
        className={cn(
          "size-7 shrink-0 text-muted-foreground",
          "data-[state=open]:bg-accent data-[state=open]:text-foreground",
          className,
        )}
        {...rest}
      >
        {busy ?? <EllipsisVertical className="size-4" />}
      </Button>
    </DropdownMenuTrigger>
  );
}
