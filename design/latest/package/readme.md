# STInventory Design System — "Blocky"

A dark, industrial design language for construction equipment and small-tool management. Built for shop monitors, field tablets, and dispatch desks — dense data, high contrast, zero decoration.

Derived from `Tools by Jobsite Blocky.dc.html` and applied across `System Shell v3.dc.html`. Extended with the wall-display surface class from `Project Monitor.dc.html`.

---

## Index

| Path | What's there |
|---|---|
| `styles.css` | Global CSS entry — import this one file |
| `tokens/colors.css` | Surface, border, text, accent, semantic scales |
| `tokens/typography.css` | Font families, sizes, weights, tracking |
| `tokens/spacing.css` | Spacing scale, radii, shadows |
| `tokens/components.css` | Component-level dimension tokens |
| `components/buttons/` | Button |
| `components/inputs/` | Input |
| `components/feedback/` | Badge, StatusPill |
| `components/navigation/` | Chip |
| `components/data/` | Label, MetricCell |
| `components/layout/` | EdgeCard |
| `ui_kits/system_shell/` | Full navigation shell recreation |
| `ui_kits/tools_by_jobsite/` | Job-crew-tool board recreation |
| `guidelines/` | 17 foundation specimen cards |

### Live designs

| File | Surface class |
|---|---|
| `System Shell v3.dc.html` | Desk — nav rail, sidebar, RBAC-gated pages, AI panel |
| `Project Monitor.dc.html` | Wall — passive auto-cycling project/tool board |
| `Tools by Jobsite Blocky.dc.html` | Desk — job/crew/tool distribution board |
| `FieldChat.dc.html` | Field — conversational tool lookup |

---

## VISUAL FOUNDATIONS

### Colors

Nine-step surface scale from `#090B0E` (body) up to `#222A33` (active chip). Every surface step is a near-black — the design never lightens past ~13% luminance. Five-step border scale from `#1B2027` (barely-there divider) to `#2E3742` (tag outline).

**Accent** is a desaturated drafting blue `#7FB0E4` — used for links, tool tags, active nav, and primary buttons. Never for decoration.

**Semantic colors are reserved and never decorative:**
- `--ok` `#4FA97A` — good condition, fully rigged, settled
- `--warn` `#E4A13B` — fair condition, missing vehicle, aging
- `--crit` `#D2694A` — damaged, overdue, work stopped

Status colors always appear at 11% opacity for backgrounds and 30% for borders — never full-bleed fills except on tick marks and edge bars.

### Type

**Inter Tight** for everything human-readable. **JetBrains Mono** for everything machine-readable — tags, job codes, counts, timestamps, labels, and numeric values.

The signature move is the **mono uppercase label**: 9.5px, `letter-spacing: .14em`, `color: var(--text-muted)`. It appears above every metric, on every table column head, and as every section kicker. If you see uppercase text in this system, it is mono and it is tracked wide.

Headings are tight — `-.02em` at 26px, `-.015em` at 16.5px. Body sits at 12.5–13px with 1.55 line height. Nothing is larger than 26px; this is a data tool, not a marketing page.

### Radii

**3–4px. That's it.** No pill shapes, no 12px cards, no fully-rounded buttons. The only circle in the system is the user avatar. The blockiness is the point — it reads as instrument panel, not consumer app.

### Backgrounds

Flat color only. **No gradients, no images, no textures, no blur.** Depth comes entirely from the surface scale and 1px borders. Sticky headers use `--surface-1` with a `--border-0` bottom edge.

### Light mode

The system is dark-first; light mode is a supported second theme, not a mirror. Two rules:

**Surfaces invert, the app rail does not.** The 48px icon rail stays near-black (`#1A1E24`) in both themes — it reads as instrument chassis and anchors the window. Because it stays dark, it carries **its own token set** (`railText`, `railActiveBg`, `railActiveFg`, `logoBg`, `logoFg`) rather than the theme's `text3`/`accentBg`/`accentFg`. Using the light theme's accent tokens on the rail puts a pale chip and dark-on-dark text against near-black — always resolve rail colors from the rail tokens.

**Semantic colors darken, they don't lighten.** On white, `--ok` `#4FA97A` becomes `#2F7D52`, `--warn` `#E4A13B` becomes `#B37A18`, `--crit` `#D2694A` becomes `#B8492A`. The accent moves from `#7FB0E4` to `#3A6E9E`. Same meaning, enough contrast to hold at 12px on a white row.

Any component that can be embedded in the shell takes a `theme` prop and resolves every color through a `theme()` map. **No hardcoded hex in an embeddable component** — that was the original defect in Tools by Jobsite, where a light shell wrapped a permanently dark board.

### The edge accent

The system's most distinctive pattern: a **3px colored bar on the left edge of a card**, communicating status at a glance across a scrolling list. Accent blue = normal, amber = needs attention, red = blocked. Crews get a shorter 3×20px tick instead of a full-height bar.

### Cards

`--surface-3` fill, 1px `--border-1` outline, 4px radius, no shadow. Cards are sectioned internally by 1px `--border-0` dividers rather than gaps — headers, metric bars, and row groups stack directly against each other. Data rows alternate between `#0A0D11` and `#0C1014`.

### Shadows

Only on floating elements — dropdowns, drawers, toasts. Deep and high-opacity (`rgba(0,0,0,.6)`) because they sit on near-black. Never on cards or buttons.

### Animation

Almost none. `transform .15s` on disclosure carets, `background .12s` on chip hovers, and a single `slideIn .2s ease-out` for the AI panel. **No bounces, no springs, no entrance animations on content.** Data appears instantly.

The exception is wall displays, where continuous motion is the entire point — see WALL DISPLAYS below. Desk and field surfaces stay still.

### Interaction states

- **Hover** — background steps up one surface level (`--surface-4` → `--surface-5`)
- **Active/selected** — `--surface-8` fill with `--border-2` outline, text goes to `--text-heading`, weight to 600
- **Primary selected** — `--accent-bg` fill, `--accent` border, `--accent-fg` text
- **Press** — no separate state; the hover step is sufficient
- **Disabled** — `--surface-4` fill, `--text-muted` text, `--border-1` outline

### Layout

Fixed sticky headers. Max content width 1500px with 44px horizontal padding on wide views, 18–22px on shell-embedded views. Dense vertical rhythm — 8–12px gaps between cards, 8–10px row padding. Scrollbars are styled thin (10px) with `#242A31` thumbs.

---

## WALL DISPLAYS

A third surface class alongside the desk and the field phone: a screen nobody touches. Project Monitor is the reference implementation. Different rules apply.

### Structure

Five fixed bands, no page scroll — **the only thing that moves is the table body.**

| Band | Height | Holds |
|---|---|---|
| Status bar | 60px | Label + live/paused state, portfolio metrics, clock, pause, fullscreen |
| Subject header | ~90px | Project code (26px mono), status pill, name, city; per-project metrics right |
| Table | `flex:1` | The payload — fixed-height rows, sticky column head, fixed scroll rail |
| Aggregate bar | 44px | Tools-per-foreman chips |
| Transport bar | 68px | Previous project (left), progress + dots + countdown (center), next (right) |

### Type floor

**Nothing below 12px, values at 14–26px.** A wall display is read from across a room, not from 60cm. The 9.5px mono label survives only as column heads and kickers, where its position carries the meaning.

### Motion

The one place this system animates continuously. Two clocks:

- **Dwell** — `12s + 1.1s per row`, capped at 52s. A 4-tool project holds ~16s; an 18-tool project holds the full 52s. Fixed dwell either rushes long lists or strands short ones.
- **Travel** — the table holds at the top for the first 18% of dwell, scrolls through the middle, and settles by 88%. Rows are never moving when the project changes.

Scroll position is driven imperatively from a ref on each tick, not through CSS animation — the travel has to stay locked to the dwell clock and reset cleanly on manual navigation.

### Orientation

A passive viewer arrives mid-cycle and needs to know where they are without waiting. Three answers, always on screen: **previous and next project named in the bottom corners** (not implied by a peek or a dot), a **fixed scroll rail** showing travel through the current list, and a **countdown** to the next change. Dots give position in the set; the rail gives position in the list.

### Interaction

Everything is optional. Pause holds the current project and freezes the countdown; the dwell clock resumes from where it stopped, not from zero. Prev/next and the dots jump immediately and reset both clocks. Fullscreen pins to the viewport with `position:fixed`.

### Embedding

An embedded wall display pins to its container with `position:absolute; inset:0` against a `position:relative` box. Percentage height does not resolve through an auto-height mount wrapper — the shell grows to natural content height, the table stops scrolling because `maxScroll` is 0, and the transport bar lands below the fold. **A scrolling embed needs a definite height at every link in the chain.**

### Transparency & blur

Used only for status backgrounds (11% color washes) and modal scrims (`rgba(9,11,14,.66)`). **No frosted glass, no backdrop-filter.**

---

## CONTENT FUNDAMENTALS

### Voice

Plain, declarative, operational. The copy reads like a foreman's notes, not a product tour.

**Sentence case for prose. Mono uppercase for labels.** Never title case in body copy.

### Tone examples

From the real designs:

- *"sitting in warehouses, not out on a job"* — explains a state in the operator's own words
- *"Nobody can confirm where these are"* — names the human problem, not the data condition
- *"Cannot be identified if stolen"* — states consequence, not classification
- *"Nothing here moves on its own"* — a section subtitle that sets expectation
- *"2 crews need vehicles"* — counts first, noun second
- *"out 26d"* / *"stale · 4d"* — abbreviated in dense contexts, never abbreviated in prose

### Rules

- **Second person for actions** ("Needs you"), third person for records ("Ruiz gave the rotary hammer to Barnes")
- **Numbers lead** — "4 tools", "62 in the yard", "11 days past due"
- **Name the consequence** — don't say "no serial number", say "cannot be identified if stolen"
- **Empty states explain, don't apologize** — "No jobs, crews, or tools match 'x'"
- **No exclamation marks. No emoji.** The single exception is the `⚠` glyph in warning pills, and even that is optional
- **Comparative counts use slashes** — "2/3 with truck", not "2 of 3"
- **Time is relative and abbreviated** — "2h ago", "out 11d", "3 d late"
- **Wall displays state, they don't address** — "NEXT IN 34S", "5 projects · LIVE", "PREVIOUS / NEXT UP". No second person on a screen nobody is standing at

---

## ICONOGRAPHY

**Inline SVG, 24×24 viewBox, `stroke-width: 1.8–2.4`, `stroke-linecap: round`, `fill: none`.** Stroke color is always `currentColor` or an explicit token — never hardcoded.

Sizes: 12–13px inline in rows, 14px in inputs and toolbars, 17px in the app rail.

The icon vocabulary is Lucide-shaped (the paths match Lucide's geometry) but hand-inlined rather than loaded from a package — every icon in the source designs is written directly into the markup. Truck and trailer glyphs are custom: simple box-plus-wheels outlines drawn to read at 12px.

**No icon font. No emoji as iconography. No PNG icons.** The `⚠` and `⊞` and `▾` unicode glyphs appear occasionally in tight spaces where an SVG would be overkill.

### Caveat

No logo file was provided in the source designs. The brand mark is the letterform **"SI"** or **"ST"** set in JetBrains Mono 700–800 inside a 26–30px accent-filled square with a 5–6px radius. Wherever a real logo would go, this monogram stands in. **A real logo should replace it.**

---

## Intentional additions

The source designs are page-level compositions, not a component library, so the component inventory below was factored out of repeated patterns rather than copied from a defined set:

- **Button** — extracted from the "Send request" / "Approve & order" / "Cancel" patterns
- **Input** — extracted from the search fields (all three designs share one spec)
- **Badge** — extracted from job-code and count tags
- **StatusPill** — extracted from the "N stopping work" / "N crews need vehicles" callouts
- **Chip** — extracted from the filter/tab rows
- **Label** — extracted from the ubiquitous mono uppercase label
- **MetricCell** — extracted from the horizontal metrics bars
- **EdgeCard** — extracted from the 3px-edge card pattern

Each maps to a real pattern in the source. Nothing was invented to round out a "standard" set.
