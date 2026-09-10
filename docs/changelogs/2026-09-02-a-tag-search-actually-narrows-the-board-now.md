# A tag search actually narrows the board now

Reported directly: searching a tool's tag or serial on /jobsites — the exact
kind of lookup a foreman does dozens of times a day — left almost every job
card on screen. Real bug, found by using the feature rather than by a spec,
and it predates this week's card-view work; the list view had it too.

## The bug

The `cards` derivation's final prune step reads:

```
if (anyFilter && c.toolCount === 0 && c.crews.length === 0) return false;
```

The intent, stated in the comment above it, was right: "a card filtered down
to nothing is noise." The check was wrong. `crews` is built by `buildCrews`
*before* any filter narrows a crew's tools — every foreman on a project gets
a crew entry regardless of whether their tools ended up matching, so
`crews.length` stays non-zero for almost any staffed job no matter what was
typed. Search "TOOL-0001" and NEX's 210 tools all fail the tag match, its
crew's `tools` array empties to `[]`, `toolCount` correctly reads `0` — and
the card survives anyway, because it still has a crew. Every staffed job on
the board passed that test. Searching did nothing.

## The fix

A text search and the browsing filters (status, category, high-value, gap)
turn out to want different leniency, and conflating them under one `anyFilter`
check was the actual mistake. For status/category/gap, keeping a staffed
job with zero matching tools visible is arguably right — "here is a real
crew, nothing of theirs matches this filter" is information. For a text
search it never is: nobody typing a tag wants back every job that merely has
people on it.

So a non-empty search now drops a toolless card outright, unless the job's
own name or code is what matched — a freshly awarded job with no tools yet
should still surface when you search its name. Every other filter keeps the
original, more forgiving rule.

## Verified

- New spec, `jobsites-search-narrows.spec.ts`, against the seeded demo data:
  searching `TOOL-0001` (unique to Lone Star, 156 tools) keeps Lone Star and
  drops NEX (210 tools, a real crew, zero matches) by name — the precise
  shape of the bug — and asserts the visible card count actually collapses,
  not just that one card is gone.
- **Proven able to fail**: stashed only the `page.tsx` fix and reran — red,
  failing on exactly the NEX-still-visible assertion. Restored, green.
- Deliberately written against the list view, not the card grid: the bug
  lives in the shared `cards` array, so it broke both renderings equally,
  and `section header` is the cheaper selector to assert on.
- `pnpm typecheck` clean; `turbo run test` green across all eight packages;
  the other jobsites/table specs (`no-layout-shift`, `table-columns-align`,
  `jobsites-card-view`) pass unchanged.

## Where it is

Committed on `development`. One line changed in the actual filter logic
(`apps/web/app/(app)/jobsites/page.tsx`); everything else is the new spec.
