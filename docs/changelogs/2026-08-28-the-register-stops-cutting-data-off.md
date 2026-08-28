# The register stops cutting data off

Two things in one screenshot: tool names clipped to an ellipsis on every visible
row, and the `IN MAINTENANCE` pill printing across the Holder column beside it.

Both measured rather than eyeballed, because "looks tight" and "overflows by
14px" are different bugs with different fixes.

## What changed

### The status column is sized for the longest status, not the common one

`StatusPill` is `whitespace-nowrap`, so when it does not fit it cannot wrap — it
overflows and prints over whatever is next to it.

`in_maintenance` is the longest member of `ASSET_STATUSES`, and renders as
fourteen mono uppercase characters with 0.1em tracking, a dot and a border:
**134px**. The column was `8.5rem`, whose content box after padding left less
than that, so the pill ran **14px** into Holder. Measured by substituting the
label and comparing the pill against the cell's content box.

Now `10.5rem`, which fits it with room.

### The tool name column had no width at all

It was the only flexible column, so it absorbed whatever the ten fixed columns
left over — **192px on a 1440px screen**, against names like "BOSCH 11255VSR
HAMMER DRILL EXTREME BULL DOG (8A)". Every one of the 25 visible rows was
truncated.

It is `20rem` now: 320px, and 10 of 25 still clip rather than 25 of 25.

**A name can still outrun that**, so the clipped ones are no longer lost: the
name carries a `title` with its full text. The text was always in the DOM — the
ellipsis is a CSS effect — so this costs nothing and makes the long tail
readable on hover.

## What was found while building it

**The bug is invisible on the development seed.** Local data holds only
`available` and `assigned`; `in_maintenance` exists in the enum and in Urban's
data, and nowhere in the fixtures. So the overflow cannot be observed by looking
at a running local stack, which is presumably how it shipped. The test therefore
substitutes the longest label and measures, rather than hoping a row with that
status exists — a test that only passes because the data lacks the problem is
not a test.

**A negative check nearly passed for the wrong reason.** Reverting both widths
to prove the tests catch the bug showed the tool test failing and the pill test
passing, which looked like a weak assertion. It was not: the revert script had
matched Holder's `10.5rem` rather than Status's, so the status column never went
back. Reverting that one column alone produced `Received: 14` — the exact
overflow. Worth recording because "the test passed when I broke it" is normally
the test's fault and this time was the check's.

## Verified

- The pill: 134px against a 168px column, inside its content box. At the old
  `8.5rem` the same measurement reports 14px of overflow.
- The names: 192px → 320px, rows clipped 25/25 → 10/25, and every row carries
  its full name as a `title`.
- Both new tests confirmed to FAIL against the un-fixed widths.
- 46 browser tests, `pnpm typecheck` and `pnpm lint` clean.

## Deliberately not done

**The table still scrolls horizontally**, and is wider than before — 1620px in a
1054px region on a 1440px screen. Eleven columns of genuinely useful data do not
fit a laptop, and the register is deliberately a spreadsheet. Narrowing it means
dropping or collapsing columns, which is a product decision rather than a
sizing one.

**No column-visibility control was added here.** That is the honest fix for a
table with more columns than screen, and it is a feature, not a bug fix.

## Where it is

Committed and merged to `main`. No schema change.
