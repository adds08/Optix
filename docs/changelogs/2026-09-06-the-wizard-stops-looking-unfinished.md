# The wizard stops looking unfinished

2026-09-06

The first-run wizard worked and looked like nobody had looked at it. Five faults,
found by screenshotting the real stack at 1440×900 rather than by reading the
source — which matters, because two of them are obvious in a screenshot and
invisible in the code.

## How they got shipped

The previous round was verified by reading the CSS and running the tests. Both
passed, and both were the wrong instrument. I wrote the classes, so I "knew"
what the screen looked like; I had never actually opened it. CLAUDE.md rule 2
says run it before claiming it, and a layout claim is not verified by a green
test suite.

## What was wrong

**The header never changed.** Lockup, greeting, a two-line paragraph and the
rail took 215px of a 900px viewport, identical on all five steps. By step five
a stale "Let's get you set up, Dana" was crowding a single sentence of content.
The greeting is a welcome, and a welcome repeated five times is furniture. It
now animates closed after step one, leaving a 121px bar carrying the mark, the
progress and Skip.

**Step five was ~500px of empty ground.** The step block was top-aligned inside
a fixed-height flex area, so a short step stranded the footer at the bottom of
a void and the screen read as something that had failed to load. This was the
single worst thing about it.

**Two progress indicators said the same thing**, three inches apart — a filled
bar and a five-dot stepper. The dots were written as "the way back", then the
bar was written as well, and the two were never seen side by side. The dots are
gone; Back is in the footer and the step is named beside the count.

**The photo panel ignored the form.** It was the sign-in slideshow verbatim, so
the same sentence about transactions sat beside all five steps, rotating on its
own 7-second timer. `AuthSlideshow` now takes an optional `slide`, and the
wizard drives both photograph and copy from the step. Sign-in passes nothing
and is unchanged.

**Everything sat at one elevation** — rows, search field and map all on the page
background behind a hairline, so nothing was foreground. One card surface now
lifts the step's content, with the header and footer on the ground behind it.

## The centring trap

`justify-center` on the step's scroll container was the first attempt and it
broke step one: on a scroll container, centring applies to overflow too, so a
block taller than the box has its top pushed above the scrollport with no way
to scroll up to it. Step one lost its heading and its search field, which the
screenshot caught immediately. `my-auto` on the child centres when there is
room and collapses to nothing when there is not — it cannot push a block that
already overflows.

## The progress screen

Same treatment, plus two colour corrections. The completion bar used
`emerald-500` and the deferral chips used a pair of Tailwind ambers with a
`dark:` variant — raw colours that ignored the palette and stayed the same on
every theme. Both now use the reserved status tokens (`--ok`, `--warn`), which
already handle both themes. "Not on the map" is amber rather than the same grey
as everything else: it is a gap somebody has to close, and it should be
scannable against the rows that are fine.

## Verified

Every step screenshotted in both themes at 1280 and 1440, through to the
completion screen and the progress page. No console errors anywhere in the
flow, and the Leaflet map still mounts cleanly inside the new card. `pnpm
typecheck` and `pnpm lint` clean; 351 api-contracts tests pass.

No router, query or permission was touched — this is layout, motion and one
optional prop. Last round's behaviour fixes (the claim ticks, skip-and-resume,
the `/home` gate ordering) are untouched.
