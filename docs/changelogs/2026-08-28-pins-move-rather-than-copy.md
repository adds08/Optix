# A pin moves a row, and the app opens on it

Three corrections to the pinned-rows feature, all from using it.

## What changed

### A pinned row leaves its group

It used to be drawn twice — once under Pinned, once in its own module — on the
stated reasoning that "Pinned is a shortcut, not a move". Wrong in practice: two
identical rows a few pixels apart read as a duplicate, and pinning something
already in view looked like it had done nothing but make a copy.

The filter is applied to the **sidebar's rendered rows only**, never to
`railGroups`. That matters more than it sounds: Registry has exactly one row, so
filtering the group itself would make pinning Small Tools delete the Registry
glyph from the rail. The module stays; only its pinned rows move up the pane.

### The control is a pin

`Star` became `Pin` / `PinOff`. A star means "favourite" and invites a rating; a
pin means "keep this here", which is what the control actually does. The
aria-labels already read "Pin X" / "Unpin X", so they were describing a star
that behaved like a pin.

### The landing route works on every visit, not just at sign-in

The first pinned row was already the landing destination — but only after a fresh
sign-in. Returning to the app with a session already in hand took the other path
through `/`, which redirected to `/home` without arming the marker. So "the first
pin is the default navigation" was true exactly once per session and looked
broken every time after.

Both paths arm it now, through one `armPinLanding()` helper.

## What was found while building it

**"Only a fresh sign-in" was the bug, and it was invisible from the code.** Both
redirects sit six lines apart in `app/page.tsx` and only one had the marker. The
test written for the original feature signed in every time, so it passed, and the
behaviour everybody would actually meet — open the app again — was never
exercised. The new test uses a stored session and would have caught it on day one.

**Reversing the both-places decision needed the rail checked, not just the pane.**
The obvious implementation filters pinned ids out of the groups themselves, which
is correct for the sidebar and wrong for the rail: a single-row module would lose
its glyph the moment you pinned it. The filter belongs at the render, not at the
data.

## Verified

- 36 browser tests green, including three new ones: a pinned row appears exactly
  once, a returning session lands on the pin, and no pins still lands on `/home`.
- The returning-session test was checked against the un-fixed code first — it
  fails there with `Expected /custody, Received /home`.
- `nav-pins.spec.ts` now asserts a count of exactly 1 where it asserted 2. That
  number is the whole difference between the old design and the new one, so it is
  asserted exactly rather than loosely.
- `pnpm typecheck` and `pnpm lint` clean.

## Deliberately not done

**No pin limit.** Nothing stops somebody pinning every row, which would leave the
active group empty and the whole pane under Pinned. That is a coherent state and
arguably what they asked for; a cap would be a rule invented for a problem nobody
has reported.

## Where it is

Committed and merged to `main`. `.claude/rules/web.md` carries the reversal, the
render-not-data note about the rail, and the arming rule for both entry paths.
