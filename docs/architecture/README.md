# Architecture

The system as built. Five documents, each derived from the code rather than from
memory or from an earlier document.

| File | What it answers |
|---|---|
| [`01-data-model.md`](01-data-model.md) | What is stored, how the tables relate, and why the ledger is the truth |
| [`02-backend.md`](02-backend.md) | The process, the routers, the custody chokepoint, the workers |
| [`03-frontend.md`](03-frontend.md) | The two clients, the shell, the table system, theming |
| [`04-data-flow.md`](04-data-flow.md) | How a fact gets in and how it comes back out |
| [`05-features.md`](05-features.md) | What the product does, feature by feature, with what is and is not built |

## What these are, and are not

**They describe the present.** Unlike `built/` and `changelogs/`, which are dated
records and must never be brought up to date, these must be corrected whenever the
code moves under them. That is the deal: a document claiming to describe the
present is worth having only if it is kept true.

**The code wins.** Every one of these names the file it was derived from. When a
document and the code disagree, the code is right and the document is a bug — fix
it in the same change rather than noting the discrepancy somewhere else.

**They are not the rules.** `.claude/rules/*.md` is what an agent reads before
editing an area, and it is where an invariant belongs. These are the map that gets
you to the right rule file. A rule written only here will be missed.

## Why they exist

The document they replace described every table by a name that had not existed for
a day, and nothing about it looked wrong. A stale reference doc is worse than no
doc because it is obeyed confidently — that is written into `CLAUDE.md` as rule 9,
and it is the reason the foreign-key graph in `01-data-model.md` was extracted from
`.references()` calls by a script rather than typed out.
