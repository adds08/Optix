# Brand artwork

The logo as supplied, 2026-09-01. Two files and nothing derived from them:

- `optix-wordmark.png` — OPTIX, 512×143, #FFCA00 on transparent.
- `optix-plate.png` — the navy stadium the wordmark sits on, #082F49.

**These are the source of the geometry, not a copy of it.**
`apps/web/components/optix-mark.tsx` is the wordmark rebuilt as stroked SVG paths,
measured off this raster's alpha channel and checked back against it pixel for
pixel. The favicon, the two web app icons and every PNG in `apps/mobile/assets`
were generated from the same measurements. So if the artwork is ever reissued,
replace these files and **re-measure** — the coordinates in `optix-mark.tsx` are
a measurement, and nudging one bends a letter with nothing to warn you.

They live here rather than in `apps/web/public` because nothing serves them: the
web app draws the mark, and the mobile app carries its own composed raster
(`apps/mobile/assets/optix-logo.png`, the wordmark on the plate).
