---
name: visual-explainer
description: Build a self-contained HTML explainer that teaches something complex -- an architecture, a subsystem, a data model, an incident, a migration plan. Use when the user says "explain this to me", "help me understand", "I want visuals", "walk me through", "make a diagram", "build me an HTML explainer", "pretend I don't know X", or when an answer would need a table of 4+ rows / 3+ columns, several diagrams, or side-by-side option comparison. Also use proactively when a subsystem is too large to explain in chat.
---

# Visual Explainer

Turns research into one HTML file a person can read, scroll, and come back to.
Terminal output is the wrong medium for a feature spec: it can't show a
schedule, a UI, or who-owns-what side by side.

**Explaining is the job, not decorating.** A page of pretty cards that restates
the ticket has failed. The reader should finish knowing things they could not
have got by reading the source themselves.

## Non-negotiables

1. **Verify before you write.** Every claim carries a source: `file:line`, a doc section, or "verified live" with what you ran. If you can't cite it, it doesn't go in -- or it goes in explicitly labelled as your inference.
2. **Self-contained.** One `.html` file. No CDN scripts, no webfonts, no remote images, no `fetch`. It must render identically with the network off. See `references/security.md`.
3. **Write only where you were asked to.** Default to `scratch/explainers/`. Never `~/`, never a shared/global path. Never auto-open a browser.
4. **Mark the unknowns.** Carry `[TBD]`s through as visible chips. Never resolve one by guessing.
5. **Separate spec from mockup from proposal.** A prototype faking a behaviour client-side is not a built behaviour, and your technology suggestion is not a decision. Label all three.

## Workflow

### 1. Gather (parallel)

Pull the primary sources yourself; fan the rest out to subagents in one message.

**The code is the primary source.** Every doc in this repo has drifted from it at
least once, so verify rather than quote. In rough order of trustworthiness:

| Source | Trust |
|---|---|
| The running app + the database | Highest — it cannot be out of date |
| Rationale comments in `packages/domain`, `custody.ts`, `fold.test.ts` | Very high — they name the specific bug each rule prevents |
| `AGENTS.md` | High — §2 is the best ten-rule orientation in the repo |
| `docs/changelogs/` | High — what actually shipped, per body of work |
| `README.md`, `docs/*.md` | **Verify before quoting** — routes, table counts and "not built" claims have all been wrong |

**Run it before you write about it.** A claim you can check in 30 seconds should
never ship as an inference:

```bash
make ENV=local up && make ENV=local seed
```
then drive the real UI with the Playwright MCP and query the ledger with
`make ENV=local psql`. Screenshots of the real screens beat any redrawing.

Typical fan-out: one agent per subsystem (data model / API + auth / frontend /
intent + infra), one to vet anything you are recommending. Give each a narrow
scope and demand `file:line` citations — a broad prompt is how a research agent
stalls. Then **verify the headline claims yourself against the running stack**;
subagents report plausible things that turn out to be wrong.

### 2. Decide what the reader doesn't know

Ask, or infer from how they phrased the request. For this product the primer that
is almost always needed is **custody vs ownership** -- that the Equipment
Department owns every tool permanently, that a foreman is a custodian and not an
owner, and that "where is it" is *calculated from a ledger* rather than stored.
A reader who has not been told that will misread every screen and every table.

Getting this wrong is the most common failure: a technically correct document
aimed at the wrong altitude teaches nobody.

### 3. Plan the page

Sketch sections and pick a visual per idea using `references/diagram-patterns.md`.
Read `references/design-system.md` and take the tokens from it verbatim.

Every explainer of a *feature* should answer, in this order:

1. What is it, in one sentence a non-engineer would repeat correctly?
2. Why does it exist -- what does the manual version cost today?
3. What are the moving parts, and what does each do?
4. Who does what: which repo, which service, which agent, which human?
5. What already exists vs what we have to build?
6. What decisions are still open, and what are the options?
7. Where do I go to see more -- every link, live and clickable?

### 4. Build

Write the HTML with `{{IMG:name}}` placeholders, then inline the assets with a
build script (`templates/build.py`). Keeps the authored file readable and the
shipped file self-contained.

### 5. Verify before claiming it works

Run through `references/checklist.md`. At minimum: open it and look at it. Use
the `playwright` MCP or the `mad-teams:browser-testing-with-devtools` skill to
screenshot light and dark, check the console is clean, and confirm nothing
overflows at 375px. Do not report "done" off a successful file write.

## Anti-patterns

| Symptom | Fix |
|---|---|
| Restates the README in nicer fonts | Add the synthesis the source lacks: ownership, gaps, what the docs got wrong |
| Every section is a card grid | Route each idea to its own form |
| Colour used for emphasis | Colour means one thing per document; keep it semantic |
| "We'll use X" for an undecided call | Label as proposal, show the alternatives and the tradeoff |
| Diagram of a system you didn't read | Cite `file:line` or mark it `new` |
| Ships with a CDN `<script>` | Inline it or drop it -- see `references/security.md` |

## Reference files

- `references/design-system.md` -- tokens, typography, the cadence ruler, quality floor
- `references/diagram-patterns.md` -- which visual for which idea, screenshot pipeline
- `references/security.md` -- why self-contained, and what we deliberately didn't copy from public visual-explainer skills
- `references/checklist.md` -- pre-delivery verification
- `templates/build.py` -- inlines `{{IMG:...}}` placeholders as WebP data URIs
