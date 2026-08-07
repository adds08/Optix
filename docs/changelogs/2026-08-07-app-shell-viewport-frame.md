# The app shell became a viewport frame, and the dropdowns stopped truncating

The shell scrolled the document. That one fact produced every symptom reported:
the top bar "detaching" on the way down, the sidebar colour bleeding into the
page background mid-scroll, and the rail's header sitting a few pixels off the
top bar so the two borders read as a step instead of a line.

## What changed

- **The shell is exactly one viewport tall and does not scroll.** The provider
  wrapper is `h-dvh overflow-hidden`; the rail and the content column are two
  full-height columns inside it, and the only scroll container in the app is
  the page region under the top bar (`.sti-scroll`). The top bar is a plain
  flex row now, not `sticky` — it cannot desynchronise from content it does not
  share a scroll box with.
- **The `inset` sidebar variant is gone.** It floated the content on an 8px
  `bg-sidebar` gutter with rounded corners; combined with document scroll, the
  sticky header rode up over that gutter and exposed the sidebar colour behind
  it — the "weird white and background imbalance". The rail is flush now, with
  a border.
- **The rail header and the top bar are both `h-14` with a bottom border**, so
  the job selector and the page title share a baseline and the two borders meet
  as one rule across the shell.
- **The job selector is one line instead of two.** The scope name is the long
  string in a 17rem rail; giving it the full width and demoting the job count
  to a badge is the difference between reading the job and reading an ellipsis.
- **`SidebarInset` gained `min-w-0`.** As a flex child its automatic minimum was
  its content's width, so a wide table could push the content column past the
  viewport and take the top bar with it.
- **The rail is 17rem, up from shadcn's 16.** Job labels here are
  `URB-1042 · Northgate Drive Reconstruction`.
- **`SearchSelect`'s panel sizes to its longest option** (floor: the trigger
  width, ceiling: 28rem or the viewport) instead of being pinned to the
  trigger's `widthClass`. A 14rem filter button was clipping every job name in
  the list it opened. Option rows are a fixed `h-8` and carry `title`.
- **The job-selector popover's job pane went 18rem → 22rem**, for the same
  reason, and both panes' search rows dropped from `h-10`/`h-9.5` to `h-9`.
- **`(app)/layout.tsx` reads the `sidebar_state` cookie server-side.**
  `SidebarProvider` has always written it and never read it, so a collapsed
  rail rendered expanded and then snapped shut on hydration.

## Found while doing it

- Locking the document's scroll fixed a bug nobody had filed: Radix locks
  `<body>` when a dialog opens, and on a scrolling document that shifts the
  whole page sideways by the scrollbar's width every time a modal opens. There
  is no document scroll left to lock.
- `scrollbar-gutter: stable` on the scroll region matters more than it sounds.
  Without it, navigating from a short page to a long one shifts the content
  sideways as the scrollbar appears.
- The collapsed rail clipped the job selector's folder mark and kept the count
  badge instead: in a 32px square the `shrink-0` trailing elements win the
  squeeze, so they need an explicit `group-data-[collapsible=icon]:hidden`.
- `sticky top-*` inside a page still works and needs no header offset — it
  resolves against the scroll region, which starts below the top bar. The
  jobsites activity aside was checked against this.

## Not done

- **The map page still sizes itself with `h-[70vh]`.** `vh` does not know about
  the top bar, so inside the new frame the map ends short and leaves dead space
  below it. Making it fill means also giving the "On the map" list its own
  scroll box, which is a page redesign, not a layout fix — flagged, not taken.
- Nothing was done about density or spacing inside pages. This was the shell
  and the dropdown primitives only.

## Verified

Headless Chrome against the local Docker stack (`localhost:3100`), signed in as
`owner@stinventory.local`: `/jobsites` and `/map` at 1440x900 in light and dark,
scrolled deep, rail expanded and collapsed to icons, filter and job-selector
popovers open, and `/jobsites` at 430x860 with the rail as a sheet. Typecheck
clean; lint warnings are all pre-existing in untouched files.

## Deployed

Local Docker only. Not deployed.
