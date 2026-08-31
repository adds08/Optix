# The ticket numbers were lying, so they are gone, and Jira goes with them

Two clean-ups that turned out to be the same clean-up, plus the ticket that started it.

A QA pass was validated against the repository and the tracker. Checking it surfaced a
problem bigger than any of its findings: **`docs/tickets/` had stopped describing reality,
and the tracker was carrying a second, competing set of ticket numbers that looked exactly
like this repository's own.**

## What changed

### The QA pass is now a ticket

`docs/tickets/duplicate-transfer-race-and-the-qa-pass-findings.md`, with no ticket id and
no tracker references. It carries the one real defect — `transfer.create` runs its "one
open hand-off per tool" check on `ctx.db` thirty lines before the transaction opens, with
no unique index behind it — plus the two non-defects (a "regression" that never existed,
and a shipped feature nobody could find) and the stale test environment that explains
several of the blocked rows.

It also records where the QA report was wrong, so the next reader does not inherit it. The
most important correction: the report rests its top recommendation on landing a patch from
a branch called `bugs-fixing`. **That branch does not exist** — not locally, not on the
remote, and no branch in the repository contains the index it describes. The fix is
uncommitted work on one machine.

### The tracker import machinery is deleted

`gen-jira.js`, `jira-import.csv` and `jira-import.json` — 178KB of Release 1 import
tooling that was never pointed at Release 2. Every prose reference to it was rewritten in
`AGENTS.md`, `docs/README.md`, `HANDOFF-RELEASE-1.md`, `PERMISSION_MATRIX.md` and
`RELEASE_1_SPRINT_PLAN.md`.

That generator is *why* the tracker and the repository disagreed. It stamped `[STI-nnn]`
into every ticket summary from the **sprint plan's** numbering, which is a different scheme
from `docs/tickets/STI-nnn`. In the tracker `[STI-501]` is "truck and trailer as
first-class assignment fields"; in this repository STI-501 was the Desk panel registry, and
truck-and-trailer was STI-202. Anyone cross-referencing one to the other landed on the
wrong document and got no error. Deleting the generator removes the machine that kept
producing the collision.

### The closed tickets are deleted and the survivors renamed

Twenty-two closed tickets, the Release 1 delivery board (`README.md`) and the wave-ordering
`EXECUTION-PLAN.md` are gone. The twenty-six that remain lost their `STI-nnn` prefix from
both filename and heading: `STI-113-assignment-return-blanks-project-location.md` is now
`assignment-return-blanks-project-location.md`.

`STATUS.md` was rewritten wherever it named a number — its links now resolve or are plain
text, and its "read these three documents in order" section no longer points at two files
that do not exist.

## What was found while building it

**The ticket Status lines were lying, and `STATUS.md` already knew.** Of the fifty-two
tickets, twenty-six said `READY`. Many were shipped:

- `STI-113` said *"READY — highest priority of the remaining"*. `CLAUDE.md` names that bug
  as fixed.
- `STI-103` said `READY`. Its index, `assignment_one_active_uq`, is live in migration `0015`.
- `STI-102`, `STI-106`, `STI-114`, `STI-117`, `STI-202`, `STI-203` — all `READY`, all cited
  as shipped in `.claude/rules/custody-and-ledger.md`.

`STATUS.md` carried a warning about exactly this and was itself internally inconsistent:
it said *"STI-120 is the one to look at first"* while `STI-120`'s own file said
`DONE — 2026-08-22`, the same day. A ticket directory that contradicts itself within one
day is not a plan; it is scaffolding nobody took down.

**The tracker is not a picture of the project.** Ninety issues: fifty in Backlogs,
seventeen In Review, four In Progress, nineteen Done. Two of the four In Progress describe
work that shipped long ago — one of them the append-only ledger trigger the QA report
itself cites as the reason a ledger row cannot be deleted. Nothing in this repository can
fix that; it is noted here so the next person does not read the board as state.

## Verified

- Every markdown link under `docs/tickets/` resolves to a file that exists.
- No reference anywhere in the repository points at a deleted document — grepped for
  `tickets/README`, `EXECUTION-PLAN`, `tickets/STI-` and the `STI-nnn-slug.md` filename
  pattern. Clean.
- No Jira or Atlassian mention survives outside `docs/changelogs/`.
- Every commit hash the QA report cites was checked against `git log`; all nineteen resolve
  to the subject line claimed. The three findings were each re-read in the source.

Docs only — no code changed, so no typecheck or test run applies.

## Deliberately not done

- **`.claude/rules/` keeps its forty-seven references, and `SYSTEM_PLAN.md` its
  twenty-four.** These are event markers in load-bearing prose — *"Since STI-103 the index
  is a backstop"*, *"Since STI-114 the no-exceptions rule is finally true in fact"*. Blind
  substitution leaves dangling sentences, and CLAUDE.md is explicit that a degraded rule
  file misleads every future change rather than only the next one. They want a sentence-level
  rewrite, not a find-and-replace.
- **The surviving tickets keep their in-body cross-references** for the same reason. The
  count across all docs went from roughly 930 to under 500, all of it structural.
- **Source comments are untouched.** The `UI-nn` and `STI-nnn` markers in test headers and
  routers name the bug each rule prevents; that is the codebase's best trait and not
  something to strip for tidiness.
- **The transfer race is not fixed.** That is the new ticket, not this change.

## Where it is

Split across two commits on `development`. The first half — the new ticket, the tracker
deletions and thirteen of the closed tickets — landed as `e5ddce2` from another hand while
this was in progress, with `#` as its subject. The second half is this commit.

Not pushed.
