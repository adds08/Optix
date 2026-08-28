# Icon size is its own knob, and the mobile question gets a measured answer

Two things arrived together: "the icons in the UI are way too small — when doing
font and scale, can we do icon as well in configuration, but do make sure it
scales properly", and "do we need to evaluate responsive theme for this,
especially if user uses mobile layout or mobile web? can you verify."

The first is built. The second is verified rather than built, and the findings
are below — one of them is a real defect that is not being fixed here on
purpose.

## What changed

### `--icon-scale`, separate from the type scale

A per-user preference: `tbl_entity_user_preferences.icon_scale`, validated by
`preferences.ts` against the same bounded pattern as the font scale, applied by
`apply-theme.ts` as a custom property on `<html>`, replayed by the boot script in
`layout.tsx`, and chosen from Settings → Appearance with a live preview showing
the three glyph sizes the app actually uses beside real words.

**Icons were never failing to scale, and that is the point of the change rather
than a caveat to it.** Everything here is rem-based, so a `size-4` glyph is 1rem
and grows exactly in step with the font scale — measured at 16.00px with a 16px
root and 22.39px with a 22.4px root. What never moved was the *ratio*. Body copy
is 0.875rem and the two commonest glyph sizes are 0.875rem and 0.75rem, so an
icon sits at or below the size of the word next to it however large the type
gets. Raising the font scale therefore could not answer the complaint, and a
wider range on the existing control would not have either.

The mechanism is an enumerated rule per size class at the bottom of `globals.css`,
scoped to `svg`:

- **Not `transform: scale()`** — it leaves the layout box where it was, so a
  grown glyph paints over its neighbour rather than pushing it along.
- **Not `zoom`** — it does move the box, but it inherits into everything nested
  and the engines disagree about the details.
- **Scoped to `svg` deliberately.** The same `size-*` classes size avatar
  circles, icon buttons and photo tiles. Those are containers the glyph sits
  *inside*; scaling them as well would scale nothing relative to anything.

Capped at 150%. Past that a glyph outgrows the fixed-height icon buttons around
it, which are sized from the type scale and not this one.

## What was found while building it

**A size class used on an `<svg>` but missing from the list simply does not
scale, and nothing fails.** There is no error, no visual break — that one icon
just stays small while its neighbours grow. `icon-scale.spec.ts` checks three
separate size classes rather than one for exactly that reason.

**The Settings test was flaky, and the flake was real.** It passed alone and
failed once in a full run. The form hydrates from `preferences.get` in an effect
and the theme store re-applies the saved preference when that lands, so selecting
before the query arrives means hydration lands on top of the selection. It now
waits for the network to settle and polls the measurement rather than reading it
once. Three consecutive clean runs after the fix.

### The responsive verification

Measured at 390×844 (an iPhone-class viewport) against the running stack, on
`/home`, `/tools`, `/jobsites`, `/people`, `/custody`, `/reports`, `/my-tools`,
`/desk` and `/settings`, and again with the icon scale at its 150% maximum:

- **No route scrolls the document sideways.** `scrollWidth` equals the viewport
  on every one of them, at both icon scales. The shell contains its content.
- **The register pages hold up.** `/tools`, `/people`, `/custody`, `/my-tools`
  and `/desk` reflow: toolbars wrap, the pager sits above the header, and the
  table scrolls sideways inside its own box — which is now visibly scrollable
  rather than silently so.
- **`/jobsites` reflows, with two small clips.** A crew row's fixed `w-[23rem]`
  grid overruns its card by about 20px, and the "Collapse all" button loses its
  last characters at the right edge. Cosmetic, and both are contained.
- **`/home` is broken at that width.** The fleet monitor overlaps its own text —
  the KPI strip runs over the headings, columns are clipped. This is not a
  missing media query. `project-monitor.tsx` is a wall-board: fixed row heights,
  a `ml-auto flex gap-6` strip, a `table-fixed` sized for a monitor on a wall.

**The finding is that `/home` needs a decision, not a stylesheet.** A wall
display and a phone are different products for the same data, and reflowing the
monitor would degrade the screen it was actually built for. The preference row
already carries `dashboard.defaultTab` with a `command` alternative, so routing
narrow viewports to that tab is the cheap answer if one is wanted. Not taken
unilaterally.

Worth stating alongside it: field roles are redirected off the dashboard to
`/my-tools` by the shell (`roles.ts` pins that), and the field client is the Expo
app, not this one. So the population actually meeting `/home` on a phone is desk
staff opening the web app off-site.

## Verified

- `pnpm typecheck` — 14 tasks, all pass.
- `pnpm --filter @stinventory/web lint` — clean.
- `pnpm test` in the api container against Postgres — 254 pass across 24 files,
  none skipped.
- `make generate` produced a single `ALTER TABLE … ADD COLUMN` (renamed to
  `0031_user_icon_scale.sql`, journal tag updated to match); `make migrate`
  applied it and `\d tbl_entity_user_preferences` shows `icon_scale | text | not
  null | '1.0'::text`.
- Round-tripped through the live API: `preferences.set` with `iconScale: "1.3"`
  returns ok, `preferences.get` reads `1.3` back, and `iconScale: "scale(9999)"`
  is rejected.
- Browser suite: **60 pass**, including the new `icon-scale.spec.ts` — icons
  track the font scale; the icon scale multiplies three separate glyph sizes and
  leaves the root font size alone; no document overflow at 150% on four register
  routes; and the Settings control previews live without a Save.
- By eye at 130% on `/tools`: glyphs visibly larger, no overlap, controls intact.

**Not verified:** how it looks on a real phone or in Safari. All of the above is
Chromium under Playwright at a phone-sized viewport, which is not the same thing
as a phone.

## Deliberately not done

- **No seeded non-default icon scale.** The column defaults to `1.0` and the
  setting is reachable from Settings on any account; seeding one demo user with
  larger icons would make that account look broken rather than exercise anything.
- **`/home` on a phone is untouched** — see above; it wants a product decision.
- **The two `/jobsites` clips are untouched.** They are cosmetic and contained,
  and bundling them into a change about icon size would hide them.
- **Nothing above `size-8` scales.** Larger `size-*` classes in this app are on
  containers — avatar circles, photo tiles — not on glyphs.

## Where it is

Branch `development`, on top of `2cf1d68`. `.claude/rules/web.md` gains an "Icon
size is a preference of its own" section under Theming, including the warning
about a missing size class scaling silently.
