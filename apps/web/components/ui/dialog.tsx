"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        /*
          `max-h` + `overflow-y-auto` are load-bearing, not styling.

          This is `position: fixed` and centred by `translate-y-[-50%]`, so a
          dialog taller than the viewport bleeds equally off the TOP and the
          BOTTOM — and Radix's modal locks body scroll, so the overflow is not
          merely hidden, it is unreachable by wheel, trackpad or keyboard.
          Without a cap the tall dialogs in this app simply lose their ends.

          Measured at 1280x720 before this line existed: the New Tool dialog was
          994px tall, clipping 137px off each end. The Create button sat at
          y=796 — Playwright itself refused to click it, "element is outside of
          the viewport" — and the validation error renders BELOW that button.
          So a user filled the form in, could not reach Create, and when they
          did reach it could not see why nothing happened. That is UI-75, and
          the same trap is UI-71, where the import column guide's last four rows
          (other, column_8, location, owning_project) fall off the bottom.

          A dialog that already fits is unaffected: a max-height only engages
          once the content exceeds it.
        */
        /*
          A BOTTOM SHEET ON A PHONE, the centred dialog above `sm`.

          Done in CSS rather than by branching on `useIsMobile`, so every one of
          the ~30 dialogs in this app gets it without being touched and without
          a hydration flash: the hook returns false on the server and again on
          the first client render, which would open every form centred and snap
          it to the bottom a frame later.

          What a phone gets: full width, pinned to the bottom, square corners
          except the top pair, up to 90% of the viewport, and it slides up
          rather than zooming from the middle. Thumbs reach the bottom of a
          phone; the middle of a small screen is where a dialog's buttons end up
          under the keyboard.
        */
        className={cn(
          "fixed z-50 grid gap-4 overflow-y-auto border bg-background shadow-lg duration-200 outline-none",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          /* Phone: bottom sheet. */
          "inset-x-0 bottom-0 max-h-[90dvh] w-full rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]",
          "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          /* sm and up: the centred dialog, unchanged. */
          "sm:inset-x-auto sm:bottom-auto sm:top-[50%] sm:left-[50%] sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:p-6",
          "sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0",
          "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
