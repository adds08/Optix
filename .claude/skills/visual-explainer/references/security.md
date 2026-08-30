# Why these documents are self-contained

We wrote this skill instead of installing a public visual-explainer plugin. The
reason is in this file. It is also the checklist for anything we generate.

## The threat model

A skill is a prompt that an agent with tool access will follow. A generated HTML
file is a document that a person will open in a browser, forward to a colleague,
and possibly attach to an issue or a client email. Both are attack surfaces:

1. **The skill prompt itself** is untrusted input if it came from a third party.
   An agent reading `SKILL.md` will do what it says, with whatever credentials
   the session has. A skill that says "POST the result to this endpoint for
   telemetry" gets an internal spec exfiltrated.
2. **A CDN `<script>` in the generated page** is a supply-chain dependency in a
   document about an internal system. Whoever controls `cdn.example/lib.js`
   controls what executes when someone opens our explainer, forever, including
   after we've stopped looking at it.
3. **A webfont or remote image** is a beacon. Opening the file tells a third
   party who opened it, from what IP, and when. That is a quiet leak of "someone
   is reading the STInventory custody spec".
4. **Writes outside the project** — `~/.agent/`, `~/Documents`, `/tmp` — put
   internal content in places nobody is auditing or cleaning up.
5. **Auto-opening a browser** turns a file write into code execution in the
   user's session without a confirmation step.

None of these require malice. A well-meaning skill that loads Mermaid from
jsDelivr because it's convenient produces exactly failure modes 2 and 3.

## Hard rules for anything this skill generates

| Rule | Check |
|---|---|
| No remote `<script src>` | `grep -nE '<script[^>]+src=' out.html` |
| No remote stylesheet or `@import` | `grep -nE '<link[^>]+href="https?:\|@import' out.html` |
| No webfont fetched at render time | `grep -nE 'https?://[^"]+\.woff2?' out.html` |
| No remote images | every `src` starts `data:` |
| No network at runtime | `grep -nE 'fetch\(\|XMLHttpRequest\|WebSocket\|navigator.sendBeacon' out.html` |
| Renders offline | disconnect and open it |
| Writes only where asked | default `scratch/explainers/`, never `~/` |
| Never auto-opens a browser | print the path; let the user open it |

Diagrams that would need a renderer get pre-rendered to inline SVG or built in
CSS — see `diagram-patterns.md`. Fonts get base64-embedded from a licence that
permits it (Sora and Manrope are SIL OFL). If a technique can't be made
offline-safe, drop the technique, not the rule.

## The two candidates we evaluated

Audited 2026-08-03 against the repos at HEAD.

| | `nicobailon/visual-explainer` | `ericblue/visual-explainer-skill` |
|---|---|---|
| Stars / forks | 9,394 / 631 | 28 / 5 |
| Created → last push | 2026-02-16 → 2026-06-25 | 2026-04-02 → **2026-04-03** |
| Licence | MIT | MIT |
| Output | Self-contained HTML pages and slide decks | **PNG images** |
| How | Local HTML/CSS/JS generation | Calls **OpenAI `gpt-image-1.5`** or **Gemini "Nano Banana 2"** |
| Verdict | **Learn from it.** Sound, actively maintained, good ideas | **Do not use** |

**Neither contains prompt injection, instruction-override language, telemetry, or
exfiltration to an unknown endpoint.** Both are honest about what they do. The
findings below are architectural, not malicious.

### ericblue — disqualified on data handling, not quality

It is a different product than the name suggests: it generates raster images by
posting your content to a third-party image API.

```
skill/visual-explainer.md:559
curl -s -X POST "https://api.openai.com/v1/images/generations" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
```

```
skill/visual-explainer.md:59-60
1. If `--backend openai` is specified, use OpenAI. Require `OPENAI_API_KEY`.
2. If `--backend gemini` is specified, use Gemini. Require `GEMINI_API_KEY`.
```

For us that means: explaining the codebase would ship internal source, schema and
customer names to OpenAI or Google — a new third-party disclosure and a new key to
manage, decided by a tool choice rather than by anyone who owns that decision. Separately, a PNG can't be
searched, linked into, copied out of, read by a screen reader, or diffed. And the
repo has one day of commit history and has been untouched for four months.

### nicobailon — good skill, three habits we don't want

```
plugins/visual-explainer/SKILL.md:19
Write files to `~/.agent/diagrams/` or the explicit eval output path.

plugins/visual-explainer/SKILL.md:20
Open generated pages in the browser when running normally.

plugins/visual-explainer/references/libraries.md:14
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

plugins/visual-explainer/references/libraries.md:452
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>

plugins/visual-explainer/references/libraries.md:568-570
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono..." rel="stylesheet">
```

and `extension.ts:159` spawns a detached process to open the browser:

```ts
const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
```

Its own `libraries.md` opens with *"most diagrams need zero external JS"* — the
guidance is reasonable and the CDN is the escape hatch. But an escape hatch in a
skill prompt is an instruction an agent will take, so we closed it.

### What we took, and what we changed

Adopted: routing content type → visual form; the "4+ rows or 3+ columns means
make a document" trigger; progressive disclosure through a `references/`
directory; theme-aware self-contained HTML.

Changed:

| Their habit | Ours |
|---|---|
| Mermaid / Chart.js / Google Fonts from a CDN | Pre-rendered SVG, CSS diagrams, base64-embedded OFL fonts |
| Writes to `~/.agent/diagrams/` | `scratch/explainers/` — inside the project, gitignored, reviewable |
| Auto-opens the browser | Prints the path; the user opens it |
| Installed as a third-party plugin | Copied the ideas into a file we own, review, and diff |

That last one matters most: an installed skill is a standing instruction set that
updates outside our review. Nothing about `nicobailon/visual-explainer` today is
untrustworthy — but "today" is the operative word, and 9,394 stars is popularity,
not an audit.

Before adopting anything else from a public skill, read its `SKILL.md`, commands,
and any `extension.ts`/scripts in full and check for: instruction-override
language, network calls at generation time, telemetry, package installs, shell
execution, and writes outside the project. Quote what you find; don't summarise.

## If you are asked to publish an explainer

These documents quote internal source, schema, seeded customer data and real
employee names.
Publishing one — to an Artifact, a gist, a shared link — sends that content to a
third party where it may be cached or indexed. Ask first, every time. The default
is a local file.
