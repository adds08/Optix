# Changelogs

One file per body of work that shipped, newest first by filename date. This is
the record of what was **done** — as distinct from `docs/NN-*.md`, which are
specs for what is **to be done**, and `CHANGELOG.md` at the repo root, which is
the user-facing release note.

## How the three relate

| Where | Holds | Written |
|---|---|---|
| `docs/workings/RELEASE_1_SPRINT_PLAN.md` | Work to be done, as stories with mechanism, AC and cases | Before building |
| `docs/NN-name.md` | A living spec: schema, subsystem design, vocabulary, ADRs | Before building, kept current |
| `docs/changelogs/YYYY-MM-DD-name.md` | What actually shipped, what it fixed, what was found on the way | After building |
| `docs/built/NN-name.md` | A spec whose feature has shipped — kept for the reasoning, not the work | On completion |
| `CHANGELOG.md` (root) | Release notes, grouped Added/Fixed/Changed | At release |

When a spec is implemented, write its changelog entry and **move the spec to
`docs/built/`** rather than deleting it — the reasoning in a spec outlives the
work, and the next person asking "why is it like this" needs it. Keep the
number: renumbering breaks every cross-reference in the repo and in the code
comments that cite it.

New work is a story in the sprint plan, not a new `docs/NN-*.md` file. That
distinction is what keeps this directory from growing back to twenty
top-level documents, half of which described a moment rather than the system.

A changelog entry records three things the commit message cannot:

- **what was found while building it** that nobody knew when the spec was
  written, because that is the part that will surprise the next person
- **what was deliberately not done**, so it does not get rediscovered as an
  oversight
- **where it is deployed**, since committed and running are different states in
  this project

## Naming

`YYYY-MM-DD-short-slug.md`, dated the day the work landed.
