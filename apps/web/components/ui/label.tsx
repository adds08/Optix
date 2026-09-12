"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/*
  The label primitive the rest of the app never had.

  Every form in this app hand-rolled a bare `<label className=...>` sitting
  NEXT TO its input with nothing joining the two — 146 of them against 10
  written correctly. A label that is a sibling rather than a wrapper, and
  carries no `htmlFor`, is not a label as far as the browser is concerned: a
  screen reader announces the field as "edit text, blank", and clicking the
  words does not focus the box.

  Radix's Label handles the click-to-focus half even without `htmlFor` when it
  wraps its control, and forwards `htmlFor` when it does not — so the fix at a
  call site is either to wrap the input or to pair `htmlFor` with the input's
  `id`. Prefer the explicit pair: it survives the input being moved into its
  own component later, which wrapping does not.
*/
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
