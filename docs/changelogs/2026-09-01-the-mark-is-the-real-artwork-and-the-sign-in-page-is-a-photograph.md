# The mark is the real artwork, and the sign-in page is a photograph

Two requests, one session: match the sign-in page's left panel to the timesheet
product's own login screen — a rotating photograph of a jobsite rather than an
animated diagram — and replace the placeholder Optix mark with the logo that was
actually supplied, plus a compact form of it for the slots too small to hold a
wordmark 3.6 times wider than it is tall.

## What changed

### The mark is now the supplied artwork, not an interpretation of it

`optix-mark.tsx`'s `OptixGlyph`/`OptixLockup` drew a generated iris — six blades
around a hexagon — as a stand-in for a logo that did not exist yet on 2026-08-27.
Two files arrived this session: `logo.png` (the OPTIX wordmark, 512×143, #FFCA00)
and a navy stadium plate. Both are checked into `design/brand/` as the source of
record, with a README explaining that they are measurements, not files to import.

The wordmark is rebuilt as stroked SVG paths — an ellipse for the O, four `path`s
for P/T/I/X — with every coordinate measured off the raster's alpha channel column
by column and row by row, then checked back against the source pixel for pixel
(IoU 0.87 against the raw silhouette; the residual is stroke-width rounding, not a
wrong coordinate, confirmed by overlaying the reconstruction on the original in a
scratch script). Paths rather than an `<img>`, so the mark inherits `currentColor`
and needs no exported file per surface or per colour.

Five exports now, one per surface rather than one shape asked to serve all of them:

- `OptixWordmark` / `OptixLockup` — the flat wordmark, for a page the app themes.
- `OptixPlate` — the wordmark on its navy stadium, for a photograph or any ground
  the app does not control. Ignores `currentColor` on purpose.
- `OptixTile` / `OptixGlyph` — the compact mark (the ring with the X shut inside
  it, filled rather than outlined so it survives being drawn at 18px) for square
  slots: the rail head, favicons, app icons.

`--brand-navy` / `--brand-yellow` are new tokens in `globals.css`, written as hex
because everything else in that file is a tunable palette decision and these two
are a measurement of the logo. `--brand-mark` answers the one real question — which
of the two a bare wordmark takes — once: navy on paper, yellow on the dark surface
below it.

Every consumer moved to the surface-appropriate export: the rail head now renders
`OptixTile` instead of a hand-built `bg-primary` square around `OptixGlyph`, and
the boot splash renders `OptixWordmark` instead of the bare glyph, both changes
made because the artwork's identity is legible at those sizes where the old
generated glyph's was not.

### The sign-in panel is a photograph

`auth-panel.tsx` — the drawn, looping diagram of a resource moving between two
jobs (a route with a token riding an offset-path, a strip of unlabelled resource
icons drawing themselves on, a ledger writing its own rows, a scanner sweeping the
whole panel every 19 seconds) — is deleted. `auth-slideshow.tsx` replaces it:
the same four jobsite photographs the timesheet product's own login page rotates
through (`timesheet/public_html/img/loginpage/{1..4}.jpg`, copied into
`apps/web/public/login/`), cross-fading every 7 seconds behind the mark and the
headline the old panel carried over unchanged — "Every move on every job is a
transaction, not a memory," the best copy in the product.

Matching the timesheet page is deliberate, not incidental: the two products are
being sold as one platform and their front doors should not look like they came
from different companies.

The photographs are CSS backgrounds, applied via inline `style`, not `<img>` tags.
The panel is `hidden lg:block`, and a `display: none` element never issues the
request a background-image needs — so a phone opening `/` fetches none of the
780KB across the four files, where four `<img>` elements would have downloaded
all of it regardless of viewport. Only the first photograph is in the server-
rendered HTML; the other three mount after hydration. `prefers-reduced-motion`
is checked once in an effect and, when set, the interval is never started — the
panel holds on the first photograph rather than removing itself, since the
picture is the content and the rotation is the only thing being asked to stop.

### Icons exist where there were none

Neither app had a favicon or app icon before this session — every browser tab
showed the blank-page glyph, and the mobile manifest still read `"STInventory"`.
`apps/web/app/icon.svg` and `apple-icon.png` are new (Next serves any `app/icon.*`
/ `app/apple-icon.*` automatically); the six PNGs under `apps/mobile/assets/` were
regenerated from the same measured geometry, and `app.json`'s `name` and Android
adaptive-icon background now read `Optix` / `#082F49` instead of `STInventory` /
a pale blue left over from a scaffold. The mobile sign-in screen's hand-set `ST`
tile and the literal string "STInventory" are gone too, replaced by
`assets/optix-logo.png` — the wordmark composed onto its plate as a single raster,
because this app has no `react-native-svg` and a logo is not worth adding one.

## What was found while building it

**`size-[62%]` does not do what it looks like it does.** `OptixTile` first sized
its inner glyph with a Tailwind arbitrary-size utility on both axes; the compiled
rule is `width:62%;height:62%`, and a percentage height only resolves against a
container with a *definite* height, which a `size-8` flex child does not
reliably give it across browsers. Sizing the width only (`w-[62%]`) and leaving
height to the glyph's own 1:1 viewBox is the fix, and it is the kind of thing that
looks fine in one browser and silently collapses to zero in another — worth
knowing before the next percentage-sized SVG.

**A stretch-aligned flex column centers an `<svg>` inside its own stretched box.**
`OptixLockup`'s wordmark floated to the middle of the sign-in panel, clear of the
left-aligned tagline underneath it, until the wrapping `<div>` got `items-start`.
An `<svg>` has no intrinsic content to left-align against, so a flex column
without `items-start` stretches it to the container width and the artwork centers
inside that box — invisible in a screenshot that only shows the wordmark alone,
obvious next to any sibling.

## Verified

Ran in a real browser against the dev server (`pnpm --filter @stinventory/web dev`
on the container's port 3100), not deduced from source:

- Screenshotted `/` in both dark and light palettes — wordmark, plate and
  slideshow render correctly in both; confirmed the slide advances on its own
  after 8s and the active indicator dot moves with it.
- Signed in and screenshotted the rail head (`OptixTile`) and the boot splash
  (`OptixWordmark`, captured by delaying the `identity.me` response) in both
  themes.
- Screenshotted `/forgot-password` — `OptixLockup` renders correctly on a page
  with no background image, confirming the flat-wordmark path independently of
  the slideshow's plate.
- `pnpm --filter @stinventory/web typecheck`, `lint` and `build` all pass; the
  production build lists `/icon.svg` and `/apple-icon.png` as static routes.
- `cd apps/mobile && pnpm typecheck` passes (run on the host per the mobile rule
  — this app has no container volume).
- No browser console errors on any of the above pages.

**Not verified:** the mobile app was not run in a simulator or on a device —
only typechecked. The new `optix-logo.png` composition was checked by eye
(screenshotted at native size in the file, not in the running app) rather than
against a running Expo instance.

## Deliberately not done

- **No third-party favicon generator or tracing tool was used.** `potrace`,
  `cairosvg` and ImageMagick were all unavailable in this environment; the
  wordmark's paths were measured by hand from the raster's alpha channel with a
  short Python script (not committed — scratch work) rather than approximated.
- **The mobile app's icon set was regenerated, not hand-designed.** The
  Android adaptive-icon foreground/background/monochrome layers are the same
  flat composition at three sizes; a real adaptive icon with proper inset and
  parallax was out of scope for a mark that only just got real artwork.
- **No animated left column was added back in any form.** The user's own read
  was that the previous panel's motion was "too much," and this replaces it
  with a photograph rather than a quieter version of the same idea.

## Where it is

Uncommitted in the working tree on `development` at the time of writing. Not
deployed — this was built and verified against the local dev stack only.
