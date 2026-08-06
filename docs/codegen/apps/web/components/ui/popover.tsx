"use client";

import * as React from "react";
import { Popover as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

/*
  The panel behind a trigger that needs real focusable content — a search box,
  two panes, a list you arrow through. DropdownMenu is the wrong primitive for
  that: its typeahead swallows keystrokes, so an input inside it cannot be typed
  into. Same visual shell as DropdownMenuContent so the two read as one system.
*/

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverAnchor = Primitive.Anchor;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
