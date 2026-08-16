# STInventory Explainer Design System

Tokens and rules for every explainer this skill produces. These are **the
product's own tokens**, lifted from the app — not invented. Copy the `:root`
block verbatim; derive everything else from it.

## Where these come from

`apps/web/app/globals.css` defines the default theme, **Drafting Ink**. Re-derive
if the palette changes:

```bash
sed -n '/^:root {/,/^}/p'  apps/web/app/globals.css   # light
sed -n '/^\.dark {/,/^}/p' apps/web/app/globals.css   # dark
```

The app ships **12 named themes** (`apps/web/lib/themes/themes.ts:34-46`) —
drafting-ink, field-amber, concrete, blueprint, forest, clay, graphite,
high-contrast, site-green, site-cream, site-slate, hi-vis. Explainers use
drafting-ink because it is the default the reader already knows.

The palette's own comment states the intent, and it is worth honouring:
*"Neutrals carry a slight cool bias toward the accent so they read as chosen,
not inherited. Radius is tight (6px) — this is a yard tool, not a consumer app."*

Deep blue-teal ink on near-white paper. That's the grounding; don't reach for a
generic cream-and-serif or black-and-acid-green look.

## Tokens

```css
:root{
  color-scheme: light dark;

  --paper:      oklch(0.988 0.003 240);
  --surface:    oklch(1 0 0);
  --surface-2:  oklch(0.965 0.005 240);
  --line:       oklch(0.906 0.008 240);
  --line-soft:  oklch(0.941 0.006 240);

  --ink:        oklch(0.195 0.016 245);
  --ink-2:      oklch(0.375 0.016 245);
  --ink-3:      oklch(0.505 0.016 245);

  --accent:     oklch(0.505 0.093 227);   /* drafting ink */
  --accent-2:   oklch(0.34 0.055 227);
  --accent-wash:oklch(0.948 0.014 230);

  --ok:   oklch(0.505 0.092 168); --ok-bg:   oklch(0.955 0.024 168);
  --warn: oklch(0.505 0.110 62);  --warn-bg: oklch(0.958 0.036 72);
  --crit: oklch(0.525 0.163 28);  --crit-bg: oklch(0.955 0.028 28);
  --idle: oklch(0.545 0.012 245); --idle-bg: oklch(0.952 0.005 240);

  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --radius: 6px;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --paper:oklch(0.172 0.012 245); --surface:oklch(0.212 0.014 245);
    --surface-2:oklch(0.252 0.014 245); --line:oklch(0.302 0.016 245);
    --line-soft:oklch(0.262 0.015 245);
    --ink:oklch(0.948 0.005 240); --ink-2:oklch(0.808 0.010 245);
    --ink-3:oklch(0.688 0.014 245);
    --accent:oklch(0.715 0.105 222); --accent-2:oklch(0.88 0.045 222);
    --accent-wash:oklch(0.288 0.032 228);
    --ok:oklch(0.735 0.105 168);  --ok-bg:oklch(0.268 0.038 168);
    --warn:oklch(0.762 0.112 68); --warn-bg:oklch(0.282 0.042 62);
    --crit:oklch(0.688 0.135 28); --crit-bg:oklch(0.285 0.052 28);
    --idle:oklch(0.665 0.012 245);--idle-bg:oklch(0.258 0.008 245);
  }
}
```

Repeat the dark body again as `:root[data-theme="dark"]` *after* the media query
so an explicit toggle beats the OS preference. Never define a colour only inside
a media or `[data-theme]` block — the un-stamped "system" state is what most
readers get, and a token that only exists behind a stamp renders one theme's text
on the other theme's ground.

`body` must set an explicit `background` from a token. A transparent body borrows
whatever ground the host paints.

### Contrast traps

The app's raw signal colours are tuned for fills and chips, not for body text on
paper. Check any pair you invent; `--ink-3` on `--surface-2` is the one most
likely to fail. The `--warn` lightness is deliberately pulled down from the app's
`0.545` to `0.505` here, because explainer text sits on paper rather than inside
a filled badge.

## Typography

Two roles, no webfonts. The app itself uses the system stack via `--font-sans`,
so an explainer that does the same is consistent *and* offline-safe with no
base64 payload. Never load a font over the network at render time.

| Role | Face | Use |
|---|---|---|
| Display | `--sans`, tight tracking | `h1`-`h3`. `-.032em` at h1, `-.018em` at h2. |
| Label | `--mono`, uppercase | Eyebrows, chips, table headers, section numbers. `letter-spacing:.09em`. |
| Body | `--sans` | Prose. `line-height:1.65`, ~74ch measure. |
| Data | `--mono` | Code, `file:line` citations, ids, tags, counts. |

Use `font-variant-numeric: tabular-nums` wherever digits line up in a column.

## The signature: the custody chain

The version of this skill these files were adapted from used a day-axis ruler,
because that project's subject was a schedule.
**This product's spine is a ledger**, so the recurring visual is the custody
chain: an append-only run of events, each carrying a complete state snapshot,
ending in a dashed box that is explicitly *derived*, not stored.

Rules for drawing it:

- The derived projection is always **dashed**; stored rows are always solid. A
  reader must be able to tell "this is a fact" from "this is calculated" at a glance.
- Events read left to right in fold order. The newest snapshot — the one the fold
  actually returns — gets the accent fill; the rest stay neutral.
- Never draw an arrow from the projection back into the ledger. Nothing writes
  backwards, and the diagram should make that impossible to imagine.
- Label the fold with its real function name, `foldAssetState()`, so a reader can
  grep for it.

## Colour discipline

Three actors, three colours, used the same way in every diagram, chip and border:

- `--accent` — the system: a ledger write, a projection, an automatic outcome
- `--warn` — **awaiting a human**: a borrow pending verification, a manual queue
- `--crit` — blocked or broken: nothing moved, or a defect

Severity colours are reserved for actual severity — never for emphasis. Never
encode meaning in colour alone: pair with a label, a shape, or a chip, and check
the page in greyscale.

Custody outcomes have a fixed mapping everywhere, because they are the product's
central three-way branch:

| Outcome | Colour | Means |
|---|---|---|
| `auto` | `--ok` | Applied as a permanent change |
| `verify` | `--warn` | Applied now as a borrow, desk confirms after |
| `approve` | `--crit` | Nothing written until a second signature |

## Layout

- One column, `max-width:74ch` for prose; full-bleed for diagrams and wide tables.
- Sticky contents rail on the left above 1080px with scroll-spy; nothing below that.
- Cards: `background:var(--surface); border:1px solid var(--line-soft);
  border-radius:var(--radius)`. No shadows in light, no glows in dark — depth
  comes from the border, matching the app's own flat treatment.
- Anything that can overflow sits in its own `overflow-x:auto` wrapper. The body
  never scrolls sideways.

## Motion

One orchestrated moment: reveal sections on scroll via `IntersectionObserver`.
Everything else instant. Gate the hidden state behind a `.js` class added by
script and behind `prefers-reduced-motion: no-preference`, so a no-JS or
reduced-motion reader gets the final state rather than a blank page.

## Quality floor

Responsive to 360px · `:focus-visible{outline:2px solid var(--accent);
outline-offset:2px}` · body text >= 4.5:1 in both themes · real alt text or
`role="img"` + `aria-label` on every diagram · one `<h1>`, no skipped heading levels.
