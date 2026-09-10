# The tick that did nothing, and a wizard with a face

Two things in one pass, after the user looked at the onboarding wizard in light
mode at a narrow window and said it was plain — and then reported that ticking a
job on step one had no effect.

## The bug: step one's ticks were never saved

Ticking a job coloured a checkbox and nothing else. `picked` was a `useState`
set that never left the browser, so steps two and three — which read
`myClaimedProjects` from the server — correctly found nothing and said "you
haven't claimed a job yet". The person had just claimed three.

This traces to a decision recorded in the plan and then only half built. The
plan says step one "does NOT write the viewer's own roster row" because
`assertCanAssign` would refuse it, and that reasoning is right: a superintendent
holds only `project.assign.foreman`, so they cannot even claim their own
superintendent row, and a PM holds none of the assign permissions at all. The
plan then says "what the tick records is intent" — and no such record was ever
built. The tick was a no-op.

`tbl_ops_project_claim` is that record. It is deliberately NOT a roster row and
is never treated as one: the roster is who the company says runs a job, written
through a permission; a claim is who a person says they work on, written by
anyone about themselves, granting nothing. `myClaimedProjects` now reads the
UNION of the two, and returns `onRoster` so the client can tell them apart.
Migration `0047`.

Six tests pin it, in their own `describe` with its own job — the first draft
reused the shared fixture and failed because the crew tests above reassign the
foreman between jobs, which is exactly the test coupling this file already got
caught by once.

## The look

The light-mode screenshot was worse than the dark one for a reason worth
recording: the jobsite photograph is `hidden lg:block`, so below 1024px the
entire left column vanishes and what remains is an unanchored form on
near-white. The design only existed above one breakpoint.

- **A display face, `--font-display` (Space Grotesk).** Chosen off the artwork
  rather than taste: `optix-mark.tsx` is stroked outlines with squared
  terminals, flat rails and a wide near-circular O, and Space Grotesk is that
  same geometric vocabulary, so a heading set in it reads as belonging to the
  wordmark above it. Chakra Petch is angular in a different direction and fights
  the mark; JetBrains Mono is already this app's machine-value face and reusing
  it for prose would blur a distinction ADR-7 makes deliberately. A third
  variable, not a replacement — `--font-sans` is untouched everywhere, and
  `--font-heading` was deliberately left alone because repointing it would
  restyle every heading in the product as a side effect of an onboarding change.
- **The step rail became a progress bar.** Five numbered chips joined by rules
  said very little and, at five steps, the numbers were larger than the labels.
  A filled bar, a monospaced `01 / 05`, the current step named, and small dots
  as the way back.
- **Job rows have presence.** A 32px icon block, the code monospaced in its own
  column, and a selected state that FILLS rather than tinting — the previous
  version was a grey checkbox on a grey row and a made choice looked unmade.
  Staggered entry, capped at eight rows so a sixteen-job list does not take a
  second and a half to arrive.
- **One content column.** Header, step and footer were on three different
  widths, which read as misalignment; they now share a `max-w-2xl` column, with
  a tinted header band separating furniture from work.
- **A completion screen.** Finish used to redirect instantly, so five steps
  ended in a page flick and the person had no way to know anything saved.
  `DoneStep` holds the moment: the mark, a sealing tick, "You're set up,
  <name>." in the display face, and three counts. The counts are read from the
  same procedures the steps used, so a silent write failure shows as a smaller
  number rather than a false congratulation. It does not navigate on its own.
  Skipping still leaves immediately — somebody who opted out has no summary.

Deliberately NOT copied from the reference the user shared: its purple and its
pill buttons. `globals.css` says in as many words that this is "a yard tool, not
a consumer app", radii are tight and depth comes from borders. What was taken is
the structure — one focal question, a thin progress bar, real option rows.

## Found while doing it

**Three onboarding reads had no `ORDER BY`** and returned heap order, so the
list reshuffled under the person whenever a mutation refetched. Same defect as
UI-73/UI-74 on the people and asset registers. All three now sort by name.

**Two guardrail tests caught the new work**, both correctly: `rbac-matrix`
flagged `setClaim` as a bare mutation (now recorded with its reasoning beside
`user.changePassword`, which has the same shape), and `onboarding.test.ts`
failed its exact-key assertion on `candidateProjects` — a test that exists
because that list is deliberately wider than normal visibility, so a new field
there has to be a decision. It was updated, not loosened.

## Verified

`pnpm typecheck`, `pnpm lint`, `pnpm test` in the api container — 346
`api-contracts` tests (six new for claims), 63 domain, all passing.

Driven in a browser at 1440x900 and at 1000x860 in light mode, the window the
complaint came from. Ticking two jobs writes two claims, step two sees them, the
ticks survive a reload, the completion screen reports "Jobs 2" against the two
actually claimed, and "Take me in" lands on `/home`. No console errors.

Local only. Not deployed.
