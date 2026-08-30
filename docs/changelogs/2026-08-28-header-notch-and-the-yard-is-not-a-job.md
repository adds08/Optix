# The header band stops short, and the Equipment Yard leaves the Jobs tab

Two reports from using Tools by Jobsite, and one investigation that did not
reach an answer.

## What changed

### The white notch was a missing `<th>`

`jobsite-tool-table.tsx` rendered an actions cell in every body row and **no
matching header cell**. A head one column short of the body does not throw and
does not misalign anything — the browser simply stops painting the header
background where the header ran out, so `bg-muted` ended at Condition and the
corner above the row menus was an unpainted white notch hanging off the band.

`colCount` in the same file already counted the actions column, which is why the
empty-state row spanned correctly and the gap looked like a styling artefact
rather than a missing element.

`e2e/tests/table-columns-align.spec.ts` now asserts header and body column counts
match on `/jobsites`, `/tools`, `/people`, `/projects` and `/custody`. It is
structural and cheap, and it catches this everywhere rather than waiting for
somebody to notice the notch again.

### The Equipment Yard is not a job

Urban carries a project literally called "Equipment Yard" — two of them, one with
cost code 24002 and one with none — plus the page's own synthetic yard card. All
three were drawn in the Jobs tab as ordinary sites, holding **zero tools**: three
cards for places nobody is working, padding the job list.

They are in the Pool now, which is what the Pool is for. The Jobs tab keeps its
fifteen real jobs.

**Matched by name, and that is the weak part.** Nothing on `project` marks it as
the department's own holding project, so a rename or a third "Equipment Yard 2"
walks straight past `isYardProject()`. The durable fix is a column on the project
— a kind, or a link to `department`. Until that exists it is one function, so
there is exactly one place to change.

### The Pool says what it holds, and the tabs are readable

The Pool tab now carries a count: *"N in the yard · N held with no job"* — the two
cards below it, summarised, derived from the cards themselves so the label can
never disagree with what is underneath it. Not shown on Jobs, where it would be
describing cards that are not on screen.

The Jobs/Pool toggle went from `px-2.5` to `px-4` with a `4.5rem` minimum, because
at the old size the pair was narrower than the sort control beside it and read as
one small chip rather than a choice.

## What was found while building it

**The first cut of the yard filter deleted the yard projects from the product.**
The pool filter keeps rows by id (`YARD`, `NOJOB`), and the new "not a job" check
was placed after it — so a real "Equipment Yard" project failed the id check,
fell out of the Pool as well as out of Jobs, and vanished from both tabs. The
diff looked right. Counting cards on both tabs is what caught it, and both
directions are now asserted in `jobsites-pool.spec.ts`.

**The layout-shift test broke as a direct consequence, correctly.** It looked for
"Waiting in the yard" on `/jobsites`, which is now only in the Pool. It clicks
through first. A test failing because the product changed is the test working.

## The theme readability report is NOT resolved

Investigated and deliberately not fixed, because I could not measure it honestly.

Two attempts produced numbers I do not believe. The first parsed computed colours
with a regex — the app resolves to `lab()` and `oklab()`, so the L channel was
read as red and everything scored ~1.5:1. The second resolved colours properly
through a canvas but failed to actually switch themes, returning identical
figures for all thirteen, which is its own proof of being wrong.

What IS trustworthy, measured through the real theme toggle on the default
palette:

| | light | dark |
|---|---|---|
| header text | 14.81 | 15.97 |
| cell text | 15.34 | 16.76 |
| **muted text** | **4.21** | 6.32 |

Body text is excellent in both. **Muted text in light mode sits at 4.21:1, just
under the WCAG AA threshold of 4.5** — which matches "a bit unreadable to some
point" better than anything else found. That is a credible lead and a one-token
change, but it is a global token that all thirteen palettes override, so it is
not something to adjust across all of them on a guess about which theme was meant.

Left open pending which theme the report was about.

## Verified

- 44 browser tests, five of them new.
- The column-count test was checked against the un-fixed code: only `/jobsites`
  fails, which is exactly the table that was missing its `<th>`.
- Card counts walked on both tabs — Jobs 15 with no yard, Pool 4 with all three
  yard cards — so the move loses nothing.
- `pnpm typecheck` and `pnpm lint` clean.

## Where it is

Committed and merged to `main`. No migration, no schema change.
