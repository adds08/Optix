#!/usr/bin/env python3
"""Render docs/data/import/rejects.json as a presentable data-quality report.

Grouped by WHO FIXES IT rather than by severity, because the audience is the
Urban team correcting source spreadsheets, not an engineer reading a log.
"""
import html
import json
import re

ROOT = "/Users/adds08/Development/Urbaniconstruction/STInventory"
SRC = f"{ROOT}/docs/data/import/rejects.json"
OUT = f"{ROOT}/docs/data/import/data-issues.html"

d = json.load(open(SRC))
rows = d["rows"]


def match(entity=None, pattern=None, severity=None):
    out = []
    for r in rows:
        if entity and r["entity"] != entity:
            continue
        if severity and r["severity"] != severity:
            continue
        if pattern and not re.search(pattern, r["reason"], re.I):
            continue
        out.append(r)
    return out


used = set()


def take(entity=None, pattern=None, severity=None):
    got = [r for r in match(entity, pattern, severity) if id(r) not in used]
    for r in got:
        used.add(id(r))
    return got


# Ordered so the two that actually block a clean register come first.
GROUPS = [
    ("Wrong in the source — needs a correction",
     "These contradict themselves. The data is loaded as-is, so the register will "
     "show the wrong value until somebody fixes the spreadsheet.",
     "critical",
     take("vehicle", r"duplicate license plate") + take("vehicle", r"VIN is not 17")),

    ("Left out of the system on purpose",
     "Loaded nowhere. Each one was excluded for the reason given.",
     "excluded",
     take("vehicle", r"out of service") + take("employee", r"place name")),

    ("Trailers nobody is holding",
     "The trailer is in the register, but no foreman is recorded against it, so its "
     "tools sit with the trailer rather than with a person. Naming a foreman in the "
     "app takes one action each.",
     "warn",
     take("vehicle", r"trailer has no custodian") + take("vehicle", r"loaded with NO custodian")),

    ("Foremen with no trailer",
     "A name and a job, but no trailer number anywhere — so there is nothing to give "
     "them custody of. Either they hold no trailer, or the trailer number is missing "
     "from the sheet.",
     "warn",
     take("assignment", r"NO trailer id")),

    ("Two sources disagree about who holds a trailer",
     "The TE summary sheet and the trailer's own sheet name different foremen. The TE "
     "sheet was used. Confirm which is current.",
     "warn",
     take("employee", r"foreman disagrees") + take("project", r"job number disagrees")),

    ("Job numbers that are not job numbers",
     "The job cell holds several numbers, or a department name. The vehicle loads; its "
     "link to a job does not, so it will show no project until one is chosen.",
     "warn",
     take("vehicle", r"job cell unusable") + take("project", r"PROPER NAME is not in either source")),

    ("Names that may be the same person",
     "Deliberately loaded as two people each. A wrong merge hands one man another "
     "man's tools; two duplicates can be merged later from the register in seconds.",
     "info",
     take("employee", r"kept separate") + take("employee", r"NOT yet ruled on")),

    ("One person, more than one vehicle",
     "Allowed, and probably correct — but worth confirming it is one person and not "
     "two people who share a name.",
     "info",
     take("assignment", r"holds \d+ vehicle")),

    ("Tool counts that do not add up",
     "The quantity and the number of serial numbers disagree, so it is unclear how "
     "many serialised units the row is.",
     "warn",
     take("tool", r"qty \d+ but")),
]

# Anything not deliberately grouped still has to appear.
leftover = [r for r in rows if id(r) not in used]
if leftover:
    GROUPS.append((
        "Everything else",
        "Recorded for completeness; none of these stops a row from loading.",
        "info", leftover))

GROUPS = [(t, s, k, rs) for (t, s, k, rs) in GROUPS if rs]

counts = d["counts"]
total = sum(counts.values())
n_block = len(GROUPS[0][3]) if GROUPS and GROUPS[0][2] == "critical" else 0


def esc(s):
    return html.escape(str(s)) if s is not None else ""


# Pull the code-ish tokens out so they can be set in the mono face.
CODEY = re.compile(r"\b((?:TE|TRK|SUV|TOOL)-[0-9A-Za-z]+|\b\d{5}\b|\b[A-HJ-NPR-Z0-9]{16,17}\b)")


def markup(text):
    return CODEY.sub(lambda m: f"<code>{m.group(1)}</code>", esc(text))


parts = []
A = parts.append

A("""<title>Urban Data Handover Issues</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
  /* Palette taken from the product's own brand tokens (globals.css):
     navy #082F49 and yellow #FFCA00. Neutrals carry a cool bias toward the
     navy so they read as chosen rather than inherited. Severity colour is
     separate from the brand accent. */
  :root {
    --navy: #082F49;
    --yellow: #FFCA00;
    --bg: #F7F9FA;
    --surface: #FFFFFF;
    --ink: #0F1C24;
    --ink-2: #46606F;
    --ink-3: #7C949F;
    --rule: #DCE5E9;
    --rule-2: #EDF2F4;
    --critical: #B3231C;
    --critical-bg: #FDF0EF;
    --warn: #9A5B00;
    --warn-bg: #FEF6EA;
    --info: #1C5A78;
    --info-bg: #EFF6FA;
    --excluded: #4A5560;
    --excluded-bg: #F2F4F5;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0A1419;
      --surface: #101E26;
      --ink: #E8F0F3;
      --ink-2: #9DB4BF;
      --ink-3: #6B838F;
      --rule: #22333D;
      --rule-2: #1A2A33;
      --critical: #FF8A80;
      --critical-bg: #2A1614;
      --warn: #F5BE6B;
      --warn-bg: #2A2013;
      --info: #7FC5E6;
      --info-bg: #12242E;
      --excluded: #9AA7B0;
      --excluded-bg: #1A2429;
      --navy: #0C2333;
    }
  }
  :root[data-theme="dark"] {
    --bg: #0A1419;
    --surface: #101E26;
    --ink: #E8F0F3;
    --ink-2: #9DB4BF;
    --ink-3: #6B838F;
    --rule: #22333D;
    --rule-2: #1A2A33;
    --critical: #FF8A80;
    --critical-bg: #2A1614;
    --warn: #F5BE6B;
    --warn-bg: #2A2013;
    --info: #7FC5E6;
    --info-bg: #12242E;
    --excluded: #9AA7B0;
    --excluded-bg: #1A2429;
    --navy: #0C2333;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: "Inter Tight", ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  code, .mono {
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.88em;
    font-variant-numeric: tabular-nums;
  }
  code {
    background: var(--rule-2);
    border: 1px solid var(--rule);
    border-radius: 3px;
    padding: 0.5px 4px;
    white-space: nowrap;
  }
  .wrap { max-width: 60rem; margin: 0 auto; padding: 0 1.5rem 5rem; }

  /* ---- masthead ---- */
  header {
    background: var(--navy);
    color: #EAF2F6;
    padding: 2.5rem 0 2.25rem;
    border-bottom: 3px solid var(--yellow);
  }
  header .wrap { padding-bottom: 0; }
  .eyebrow {
    font-size: 11px; font-weight: 600; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--yellow); margin: 0 0 0.6rem;
  }
  h1 {
    font-size: clamp(1.75rem, 4vw, 2.5rem); font-weight: 700;
    letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 0.75rem;
    text-wrap: balance;
  }
  .standfirst {
    margin: 0; max-width: 46ch; color: #B9CEDA; font-size: 1rem;
  }

  /* ---- counts ---- */
  .tally {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 1px; background: var(--rule); border: 1px solid var(--rule);
    border-radius: 6px; overflow: hidden; margin: 2rem 0 2.75rem;
  }
  .tally div { background: var(--surface); padding: 0.9rem 1rem; }
  .tally dt {
    font-size: 10.5px; font-weight: 600; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--ink-3); margin: 0 0 0.3rem;
  }
  .tally dd {
    margin: 0; font-size: 1.65rem; font-weight: 600; letter-spacing: -0.02em;
  }
  .tally dd.is-critical { color: var(--critical); }

  .lede {
    border-left: 3px solid var(--yellow); padding: 0.1rem 0 0.1rem 1rem;
    margin: 0 0 2.75rem; color: var(--ink-2); max-width: 62ch;
  }
  .lede p { margin: 0 0 0.6rem; }
  .lede p:last-child { margin-bottom: 0; }

  /* ---- groups ---- */
  section { margin-bottom: 2.5rem; }
  .head { display: flex; align-items: baseline; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
  h2 {
    font-size: 1.2rem; font-weight: 600; letter-spacing: -0.015em;
    margin: 0; text-wrap: balance;
  }
  .pill {
    font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; padding: 2px 7px; border-radius: 999px;
    border: 1px solid currentColor;
  }
  .k-critical { color: var(--critical); background: var(--critical-bg); }
  .k-warn     { color: var(--warn);     background: var(--warn-bg); }
  .k-info     { color: var(--info);     background: var(--info-bg); }
  .k-excluded { color: var(--excluded); background: var(--excluded-bg); }
  .note { margin: 0 0 1rem; color: var(--ink-2); max-width: 68ch; font-size: 14px; }

  .rows { border: 1px solid var(--rule); border-radius: 6px; overflow: hidden; background: var(--surface); }
  .row {
    display: grid; grid-template-columns: 8.5rem 1fr;
    gap: 1rem; padding: 0.7rem 1rem 0.75rem;
    border-top: 1px solid var(--rule-2); border-left: 3px solid transparent;
  }
  .row:first-child { border-top: 0; }
  .row.s-critical { border-left-color: var(--critical); }
  .row.s-warn     { border-left-color: var(--warn); }
  .row.s-info     { border-left-color: var(--info); }
  .row.s-excluded { border-left-color: var(--excluded); }
  .id { font-weight: 500; color: var(--ink); word-break: break-word; }
  .why { color: var(--ink-2); font-size: 14px; }
  .why .raw { display: block; margin-top: 0.3rem; color: var(--ink-3); font-size: 12.5px; }
  @media (max-width: 34rem) { .row { grid-template-columns: 1fr; gap: 0.25rem; } }

  footer {
    margin-top: 3.5rem; padding-top: 1.25rem; border-top: 1px solid var(--rule);
    color: var(--ink-3); font-size: 13px;
  }
  footer p { margin: 0 0 0.4rem; }
</style>

<header>
  <div class="wrap">
    <p class="eyebrow">Optix &middot; data handover</p>
    <h1>Issues found in the equipment and tool data</h1>
    <p class="standfirst">Everything below came out of the two source files. Each entry
      says what is wrong and who can fix it.</p>
  </div>
</header>

<div class="wrap">
""")

A('<dl class="tally">')
A(f'<div><dt>Rows flagged</dt><dd>{total}</dd></div>')
A(f'<div><dt>Wrong in source</dt><dd class="is-critical">{n_block}</dd></div>')
A(f'<div><dt>Needs a decision</dt><dd>{counts["warn"]}</dd></div>')
A(f'<div><dt>Noted only</dt><dd>{counts["info"]}</dd></div>')
A("</dl>")

A("""<div class="lede">
  <p><strong>What this is.</strong> The tool and trailer workbook and the company
  vehicle list were read row by row and checked against each other. Every row that
  contradicts itself, is missing a piece of information, or could be two different
  people is listed here.</p>
  <p><strong>What was done about it.</strong> Nothing was guessed. Where two sources
  disagreed, the summary sheet was used and the disagreement recorded. Where a name
  could be one person or two, it was kept as two &mdash; that is the mistake that can
  be undone. Anything with no trailer, job or foreman is parked at the Equipment Yard
  rather than dropped.</p>
</div>""")

for title, note, kind, group in GROUPS:
    A("<section>")
    A('<div class="head">')
    A(f"<h2>{esc(title)}</h2>")
    A(f'<span class="pill k-{kind}">{len(group)}</span>')
    A("</div>")
    A(f'<p class="note">{esc(note)}</p>')
    A('<div class="rows">')
    for r in group:
        sev = kind if kind in ("critical", "excluded") else (
            "warn" if r["severity"] == "warn" else "info")
        raw = r.get("raw") or {}
        bits = [f"{k.replace('_', ' ')}: {v}" for k, v in raw.items()
                if k not in ("row", "sheet") or True]
        A(f'<div class="row s-{sev}">')
        A(f'<div class="id mono">{markup(r["id"])}</div>')
        A('<div class="why">')
        A(markup(r["reason"]))
        if bits:
            A(f'<span class="raw">{markup(" &middot; ".join(bits)).replace("&amp;middot;", "&middot;")}</span>')
        A("</div></div>")
    A("</div></section>")

A(f"""<footer>
  <p>Sources: <code>TOOL LIST BY NAME NEW.xlsx</code> (the TE summary sheet and every
  TE&#8209;* trailer sheet) and the company vehicle list PDF.</p>
  <p>Generated from <code>docs/data/import/rejects.json</code>. Re-run
  <code>build_report.py</code> after the source files are corrected and this page
  reflects what is left.</p>
</footer>
</div>""")

with open(OUT, "w") as f:
    f.write("\n".join(parts) + "\n")

print(f"wrote {OUT}")
print(f"  groups: {len(GROUPS)}  rows rendered: {sum(len(g[3]) for g in GROUPS)} / {total}")
