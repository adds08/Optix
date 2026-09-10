"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-md p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        /*
          `border` is what actually separates this bar from the page, not the
          `bg-muted` fill on its own. That fill sits within 0.012 of lightness
          of `--background` in the light palette and is measurably DARKER than
          it in dark mode (`--muted` 0.181 vs `--background` 0.149) — so on a
          page whose body is already muted-toned grey, the bar it lives in was
          reading as part of the page rather than a control sitting on it.
          `--border` is calibrated (see its own comment in globals.css) to
          clear its neighbour by a real margin in both themes, which a
          background delta alone was not.
        */
        default: "bg-muted border border-border",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        /*
          The shadcn default sat an active tab's `bg-background` inside a list
          whose own background is `bg-muted` — four points of lightness apart
          in this palette (#F4F5F7 vs #F0F1F4), no border, no shadow. The
          result was three grey labels nobody could tell apart, on EVERY page
          that uses tabs (`/custody`, `/people/[id]`, `/org-chart`,
          `/onboarding/progress`) — reported directly: "the tabs are very hard
          to see, in entire pages, across all pages". Fixed at this one
          component rather than per page, since a repo-wide primitive is a
          repo-wide bug.

          Active now reads `bg-card` (a real step up from `bg-muted` — 0.042 of
          lightness in light mode, 0.013 in dark, both measured, both positive;
          `bg-background` was tried first and FAILS in dark mode, where
          `--background` is 0.032 darker than `--muted` rather than lighter)
          with a real border and a small shadow — the same "separate from its
          container" language every other raised surface in this app already
          uses — plus full-strength `--foreground` text. Inactive stays
          `text-muted-foreground` at full opacity rather than a manual `/60`,
          which is the token this app already uses everywhere else for
          "present but secondary" and is calibrated for contrast, unlike an
          arbitrary fraction.
        */
        "relative inline-flex h-[calc(100%-1px)] flex-none items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none",
        "data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        "after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
