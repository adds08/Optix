# Choosing the right visual

Most explainers fail by reaching for one form and forcing everything into it.
Pick per-idea, from the shape of the idea.

## Routing table

| The idea is... | Use | Not |
|---|---|---|
| A sequence of steps with branches | Mermaid `flowchart` | A numbered list |
| Who talks to whom, in order | Mermaid `sequenceDiagram` | A flowchart |
| A schedule / anything with day or time offsets | **Cadence ruler** (design-system.md) | Mermaid `gantt` |
| Which system owns which responsibility | CSS-grid ownership board | A bulleted list of repos |
| A record's states and transitions | Mermaid `stateDiagram-v2` | Prose |
| Comparing 3+ options on 3+ axes | HTML table with a verdict column | Paragraphs per option |
| One number that matters | A single large mono figure with a caption | A chart |
| Layers of a stack | Stacked CSS bands, widest at the bottom | Mermaid |
| An actual UI | The real screenshot, captioned | An ASCII redraw |

If a table would be 4+ rows or 3+ columns, it belongs in a document, not in
terminal output. That is the trigger for using this skill at all.

## Mermaid without a CDN

Mermaid's renderer is a network dependency, and these documents must work
offline (`security.md`). Two acceptable options:

1. **Pre-render to inline SVG.** If `mmdc` (`@mermaid-js/mermaid-cli`) is
   available locally, render each diagram to SVG and paste the `<svg>` into the
   page. Style it with `currentColor` so it themes automatically.
2. **Hand-author the SVG or build it in CSS grid.** For anything under ~10
   nodes this is usually faster than fighting a renderer, and it lets you use
   the semantic colours directly.

Never `<script src="https://cdn.jsdelivr.net/npm/mermaid...">`. If neither
option above is available, say so and use a CSS-grid diagram instead -- do not
silently ship a page that renders blank offline.

## The ownership board

The highest-value diagram for an STInventory explainer: which package owns which
piece. CSS grid, one card per package, each listing what it owns for this feature,
colour coded by the outcome palette in `design-system.md`.

```html
<div class="board">
  <article class="own" data-state="exists">
    <h4>packages/domain <span class="tag">pure · no I/O</span></h4>
    <ul><li>The event fold</li><li>custodyOutcome, overdue, idle</li></ul>
  </article>
  <article class="own" data-state="new">…</article>
</div>
```

`data-state` must be honest and is the point of the diagram:

| `data-state` | Meaning | Treatment |
|---|---|---|
| `exists` | Code is there today, cite `file:line` | Solid border |
| `extend` | Exists but needs new fields/routes | Solid border, `--issue` tag |
| `new` | Nothing exists yet | Dashed border, `--critical` tag |

A reader must be able to tell "already built" from "we have to build it" at a
glance. If you cannot cite a file for `exists`, it is `new`.

## Screenshots

Real UI beats a redrawing. Rules:

- Downscale to 1150px wide, convert to WebP q76, then base64 into a `data:` URI.
  That lands around 10-45 KB each; a 14-shot document stays under ~600 KB.
- Caption every one with what to look at, not what it is. "Note the three email
  states on each tile" beats "Tool register table".
- Screenshots show *what*; they never explain *why*. Always pair one with a
  diagram or a paragraph that does the explaining.

```python
from PIL import Image
im = Image.open(src).convert("RGB")
w, h = im.size
if w > 1150:
    im = im.resize((1150, int(h * 1150 / w)), Image.LANCZOS)
im.save(dst, "WEBP", quality=76, method=6)
```

## Charts

If the explainer needs a real chart, read the `dataviz` skill first. Do not
pull in Chart.js or D3 from a CDN -- for the small series these documents carry,
hand-authored SVG or a CSS bar/stack is smaller, themeable, and offline-safe.

## Honesty rules

These matter more than the visuals.

- **Mark the unknowns.** Specs and roadmap docs are full of `[TBD]`. Carry them
  through as a visible `TBD` chip; never quietly resolve one by guessing.
- **Separate spec from mockup.** A prototype that fakes a behaviour client-side
  is not a built behaviour. Say which is which.
- **Cite.** Every factual claim gets a source: a `file:line`, a doc section, or
  "verified live" naming what you ran. A claim you cannot cite does not go in.
- **Distinguish recommendation from decision.** Anything you are proposing gets
  labelled as a proposal, with the tradeoff stated.
