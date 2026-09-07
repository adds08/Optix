# The wizard stops wearing the shell

The onboarding wizard shipped earlier today working and looking bad. Shown the screen, the
user said so plainly. They were right, and the fault was not decoration — it was that the
screen had been built in the wrong place and nobody had looked at it at full size.

## What was actually wrong

**It inherited the app shell.** The route lived under `(app)`, so the first thing a person
ever sees of this product was a form framed by a sidebar, a project switcher, a job-scope
selector and a notification bell — every one of them vocabulary they have not learned yet.
Worse, the sidebar offered My Tools, Hand Off and Alerts: three ways out of the one screen
whose entire job is to hold somebody for two minutes.

**Thirteen identical boxes.** Step one rendered every active job as a full-width card with
a checkbox. Urban has sixteen jobs. There was no search, no grouping, and the two the
person was already on sat wherever the list happened to put them.

**The footer left the viewport.** `min-h-svh` on the column let it grow past the screen, so
Continue sat below the fold behind a page scroll — measured at 1029px of content in a
900px viewport.

**Nothing looked like the product.** Grey rounded rectangles on dark grey, no ruled
surfaces, no monospaced codes, and on step three a bright daylight map: one glaring white
rectangle in the middle of a navy page, the only surface not in the palette.

## What changed

- **The wizard moved to `/welcome`, outside `(app)`.** That is the fix the rest depends on.
  It is now shaped like the sign-in page next door — jobsite photograph on one side, the
  lockup, the task — because those two screens are one sequence and should not feel like
  two products. The photographs are the same four `auth-slideshow.tsx` already serves.
  `/onboarding/progress` is the opposite case and correctly stays inside the shell: it is
  a boss's oversight screen reached from the nav, not a first-contact surface.
- **`h-svh` plus `min-h-0`, with the step as the only scroller.** The header (mark,
  greeting, rail) and the footer (Back, step counter, Continue) are fixed furniture now.
  `min-h-0` is the load-bearing half: without it a flex child refuses to shrink below its
  content and the footer leaves the screen again.
- **Step one became a real list** (`jobs-step.tsx`): a search box over code, name and
  address; jobs already claimed lifted to the top under their own heading; a ruled
  two-column list with the job code monospaced and left-aligned so it forms a column the
  eye can run down, matching how the launcher and the jobsite cards already lead with it.
- **The map tiles are toned to the palette** via `.sti-map-tiles` — invert plus a hue
  rotation, the standard way to darken raster tiles without hosting a second tile set.
  Scoped to the TILE LAYER, never the container: filtering the container would drag the
  markers and the radius through the same inversion and turn the blue pin orange.
  Deliberately not applied to `fleet-map-view.tsx`, which has the same brightness problem
  and is its own decision rather than a side effect of this one.
- **"Confirm all" on a crew tier.** A superintendent with seven foremen was seven identical
  clicks. Offered only when more than one row is outstanding — with a single one, the
  inline button is already there and a second control beside it is noise.
- **Step headings moved into the page**, so each step component renders only its content
  and the title, blurb and spacing cannot drift between the five of them.

## Found while fixing it

**Three reads had no `ORDER BY`.** `crewStatus`, `myClaimedProjects` and `progress` all
returned heap order. This is the same defect UI-73 and UI-74 fixed on the people and asset
registers, and it bites harder here: confirming a crew refetches, and the jobs reordered
underneath the person mid-task. Caught by a browser check that clicked "Confirm all" and
compared the job order before and after — it flipped. All three now sort by name, and the
two that build their list in memory rather than in SQL sort there, with a comment saying
why.

That same reordering also made a passing feature look broken: a test asserted on
`.first()` and hit a different job after the refetch than before it. The feature was
correct; the ordering was not.

## Verified

`pnpm typecheck`, `pnpm lint`, `pnpm test` in the api container — 340 `api-contracts`
tests, 63 domain tests, all passing, no change to any of them needed.

Driven in a real browser at 1440x900. All five steps keep the footer on screen; the
photograph, mark and rail hold their position; the map renders in-palette with the pin
still blue; "Confirm all" clears a tier and the job order is byte-identical before and
after. A foreman walked the whole wizard, finished, landed on `/my-tools` and reached
`/tools` without bouncing back.

Local only. Not deployed.
