# Feature records

> **This directory is empty of instances, and that is not a reason to delete it.**
> It was deleted on 2026-08-29 for exactly that reason and restored the same day:
> `.claude/skills/feature-delivery/SKILL.md` instructs agents to write records here,
> so removing it breaks a live workflow rather than tidying an unused one. The
> convention is under-used, which is a different problem from being dead.

One folder per feature, committed. This is the memory the next person — or the next
agent — gets when they come back to a feature six months later and ask *why is it
like this*.

```
docs/features/<TICKET-ID>-<slug>/
├── TICKET.md          the ask and the acceptance criteria     (written first)
├── PLAN.md            the approach, before any code           (written second)
├── IMPLEMENTATION.md  what was actually built, and deviations (written last)
└── REVIEW.md          QA and PR verdicts, with evidence       (appended throughout)
```

## These are archives, not living documents

**A feature record is frozen when the feature merges.** It describes what happened,
in the past tense, and it is never brought up to date afterwards. If the code later
changes, that is a *new* record — this one stays as written.

This is the single most important rule here, and it is the reason the convention has
a chance of surviving. Maintained specification documents are well documented to
drift: nothing forces reconciliation after merge, the document quietly stops matching
the code, and agents then execute stale instructions at machine speed with full
confidence. An append-only archive cannot drift, because it never claims to describe
the present.

The corollary: **do not put current-state reference material here.** Anything that
must stay true belongs in `CLAUDE.md` or `.claude/rules/`, which are read every
session and therefore fail visibly when wrong.

## Scale the record to the work

| Ticket size | Files |
|---|---|
| XS — one file, no behaviour change | `TICKET.md` |
| S — one subsystem | `TICKET.md`, `IMPLEMENTATION.md`, `REVIEW.md` |
| M — multi-file, migration, or schema | all four |
| L | split into sub-tickets first; each gets its own record |

Demanding four documents for a config change is how a convention gets abandoned in a
fortnight. A folder that exists for every ticket but is skimped on for most is worse
than one that exists only where it earns its place.

## Why four files and not one

They are written at different times by different agents, and merging them would mean
rewriting history. `PLAN.md` is a *prediction*; `IMPLEMENTATION.md` is the *outcome*.
The gap between them is the most useful thing in the folder — it is where the
surprises are recorded, and surprises are what a future reader needs.

On this project that gap has already been load-bearing three times: the ledger
backfill's ordering rule, the CI drift check's `git status` vs `git diff`, and the
Next.js error-boundary props. In each case the plan was wrong in a way only
implementation revealed. A single merged document would have quietly absorbed the
correction and lost the lesson.

## What goes in each

### TICKET.md
The ask, and how you will know it is done. Acceptance criteria must be things a
reviewer can **check**, not qualities they can admire. "Handles errors gracefully" is
not a criterion; "a declined transfer leaves custody unchanged, proven by querying
the assignment row" is.

Cite `file:line` for every claim about existing code, and verify each one before
writing it. Claims copied from a doc are how a ticket sends someone to fix an
already-fixed problem.

### PLAN.md
The approach, the files expected to change, the risks, and **what is explicitly out
of scope**. The out-of-scope list is not padding — it is what stops a two-file change
becoming a twelve-file one.

Written *before* code. A plan written afterwards is a description.

### IMPLEMENTATION.md
What was actually built. Required sections:

- **Deviations from the plan, and why.** The most valuable section in the folder.
  If the plan was wrong, say exactly how — a future reader hitting the same
  assumption needs the correction, not a tidy account.
- **Decisions taken and rejected alternatives.** The rejected option and its reason
  is what stops the next person re-litigating it.
- **Anything found but deliberately not fixed**, with a ticket reference. Adjacent
  bugs get reported, never opportunistically fixed.

### REVIEW.md
Every verdict, with the evidence that supports it: QA PASS/FAIL, the PR review, and
what changed in response. Record FAILs and the fixes — a folder containing only
passes is a folder that has been curated rather than kept.

## Rules

- **Evidence, not assertion.** Paste real command output. "Tests pass" is a claim;
  the output is a fact.
- **Screenshots, traces and videos are never committed.** They are evidence for one
  run against one database state and are stale the moment they are written. They are
  gitignored. Describe what was observed in `REVIEW.md` instead; that survives.
- **Correct in place.** When a record turns out to be wrong, fix it where it is
  wrong. Do not append a correction note further down and leave the error standing.
- **No counts that will rot.** Not of tables, tests, routes or files. Name the
  authoritative source instead — the same rule `CLAUDE.md` applies to the rest of
  this repo.

## Relationship to `docs/tickets/`

`docs/tickets/` is the **board** — the live status of Release 1 work, and it changes
constantly. `docs/features/` is the **archive** — what happened, and it does not
change once a feature ships.

A ticket that is one line of a table on the board gets a folder here only if it
carried real design content. A one-line config change does not need four files, and
insisting on them is how a convention gets abandoned.
