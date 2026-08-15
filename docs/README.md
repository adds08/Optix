# docs

`workings/SYSTEM_PLAN.md` is the entry point. If any file here disagrees with it, it wins.

Numbers are stable and have gaps. A missing number means the file moved to `built/` or
`archive/`, not that it was deleted — renumbering would break every cross-reference in the
repository and in the changelogs.

## Current — read these

| File | What it is |
|---|---|
| `workings/SYSTEM_PLAN.md` | **Start here.** What the system is, what exists, what is being built, what comes next |
| `workings/RELEASE_1_SPRINT_PLAN.md` | The delivery plan: eleven deliverables as epics, stories, points, mechanisms and cases. Sprint 1 ships 24 Aug 2026 |
| `workings/jira-import.csv` · `.json` · `gen-jira.js` | The sprint plan as importable issues. Both files are generated — edit the plan, then run `node gen-jira.js .` |
| `initialPlan.md` | Urban's original brief, in their own words. Every spec traces back to this |
| `03-data-model.md` | The schema. Part A is as-built; Part B is explicitly unbuilt |
| `06-decisions.md` | ADRs 1–6. Read before changing the API surface, the mobile stack or the event model |
| `07-conversational-layer.md` | The chat → intent → custody-action subsystem and its known gaps |
| `08-custom-intents.md` | How to add an intent, and which of the two kinds you are adding |
| `09-vocabulary.md` | What the screens say and what they should say — user-visible strings only |
| `02-saas-architecture.md` | Multi-tenant productisation path and how it aligns with Mark 85 |
| `05-build-proposal.md` | Bodhi Labs scope, team and pricing. §4 is the capacity basis for the sprint plan |
| `15-vendors-and-orders.md` | **Roadmap** — vendors, purchase orders, linking a tool to where it came from |

## Other directories

| Directory | What is in it |
|---|---|
| `built/` | Specs for features that have shipped. Reference, not work queue — see its README |
| `archive/` | Superseded status reports and plans. Nothing here is current — see its README |
| `changelogs/` | What actually shipped, one file per body of work |
| `data/` | The tool-list spreadsheet and the seed generators built from it |
| `codegen/`, `codegen-jobsites/` | Generated UI drafts kept for reference |

Design concepts live outside `docs/`, in [`../design/`](../design/).

## Where a new document goes

- Describing **what the system is or will be** → `workings/SYSTEM_PLAN.md`, don't add a file
- Describing **work to be done** → `workings/RELEASE_1_SPRINT_PLAN.md` as a story
- Recording **a decision** → a new ADR in `06-decisions.md`
- Recording **what shipped** → a new file in `changelogs/`
- A spec for a feature that has now shipped → move it to `built/`

The failure mode this structure exists to prevent is the one that produced twenty files at
this level: a status report written as though it were a spec, then never retired, so nobody
could tell which documents described the system and which described a moment.
