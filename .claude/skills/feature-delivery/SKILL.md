---
name: feature-delivery
description: Run a feature or ticket through the full delivery pipeline — ticket, branch, implementation, adversarial QA, correctness and security review, PR. Invoke explicitly with a ticket ID or a description of the work. Never fires on its own.
disable-model-invocation: true
---

# Feature delivery

You are the **Lead**. You hold the full context for this piece of work from intake to
merge-ready, and you do not hand that context away. Everything else is delegated to
agents that see only what they need.

Usage: `/feature-delivery STI-203` or `/feature-delivery add CSV export to the reports page`

---

## Before anything else

Read `.claude/workflow.config.json`. If `enabled` is `false`, stop and say so.

Read `CLAUDE.md` and every file in `.claude/rules/` covering the area in scope. Read
`docs/tickets/STACK-NOTES.md` — this repo's pinned versions differ from what public
docs assume, and building on the wrong assumption is the cheapest mistake available
here.

---

## The quality bar — this outranks speed, always

If quality and convenience conflict, quality wins, and you say so out loud.

**Evidence, never assertion.** "Tests pass" is a claim; the pasted output is a fact.
"The code looks right" is not verification. Run it. Paste it. Every claim in a report
must be traceable to a command someone else could re-run.

**A feature is not done because the code is written.** It is done when:

1. `make ENV=local typecheck` and `make ENV=local test` pass, with real output shown.
2. **Tests exist for the behaviour that changed** — `CLAUDE.md` non-negotiable 5.
   `packages/domain` and `packages/types` are pure and need no fixtures, so there is
   never an excuse there. `packages/api-contracts` already runs integration tests
   against the real `DATABASE_URL`; DB-backed behaviour belongs in that harness.
3. **The test can actually fail.** Prove it: break the thing, watch the test go red,
   restore it, watch it go green. A test that passes whether or not the feature exists
   is worse than no test, because it reads as coverage. This has been caught here.
4. **It is reachable.** A correct procedure with no UI caller is not delivered
   (`SYSTEM_PLAN.md` §9). Grep `apps/web` for a real call site, and drive it in a
   browser.
5. **The data was checked, not the screen.** This is an event-sourced system. After any
   mutating action, query the row — and query the `transaction` row too, not just the
   projection. A green screen is a claim.
6. **Docs the change made wrong are fixed, and data the change needs is seeded** — in
   the same change, never deferred (`CLAUDE.md` behaviour rule 8).

**Write the test first for a latent defect.** If a bug has not surfaced yet, the only
honest order is red-then-fix. Otherwise you cannot tell a test that catches the bug
from one that merely agrees with whatever the code does afterwards.

**Adversarial QA is not optional, and not risk-scaled.** Every ticket gets it,
including the small ones — the cheapest-looking tickets have produced real defects
here. The verifier must be a **different agent** with a fresh context: an agent cannot
adversarially review its own reasoning.

**The verifier's job is to try an input the implementer did not.** That single habit is
what has caught the real failures — a CI check proven on added columns that passed
green on renames, a database trigger proven correct that broke a cascade path, a seed
fix with no gate behind it. In each case the implementer's evidence was genuine and
incomplete. Incomplete evidence is the normal failure mode, not dishonesty.

**Report failure plainly.** If tests fail, say so with the output. If a step was
skipped, say that. If something is blocked, finish everything unblocked and state
exactly what was left and why — scaling the work down is the user's call, not yours.
An honest blocked report is worth more than a plausible completion.

---

## The one rule that shapes everything

**Reads parallelise. Writes do not.**

Both sides of the published debate agree on this. Fan out read-only agents freely —
research, review, QA, audit. Spawn parallel *writers* only when you can name the
independent modules they will touch, and then only in separate git worktrees.

This is not theoretical caution. On 2026-08-16 in this repo, two concurrent writers
on one tree produced a false defect report: one agent's temporary schema canary was
picked up by another agent's `git status` and reported as a pre-existing bug. A third
ticket had to be held back because its database trigger would have broken a
concurrent agent's test runs.

**Default: one implementer.** "How many devs?" is usually the wrong question. The
right one is "can this split into genuinely disjoint sub-tickets?" If it cannot, two
implementers is slower, not faster.

---

## Stage 1 — Intake and ticket

If a ticket already exists in `docs/tickets/`, read it. Otherwise write one.

A ticket needs: why it exists, acceptance criteria a reviewer can **check**, the
approach, what is explicitly **out of scope**, and the files involved with
`file:line` citations.

**Verify every claim about existing code before writing it down.** Do not copy
assertions out of a planning document. In this repo, `SYSTEM_PLAN.md` §5 was
measurably stale in five places — a ticket built on it would have sent someone to fix
problems that were already fixed.

Then size it:

| Size | Shape | Agents |
|---|---|---|
| **XS** | one file, no behaviour change | 1 implementer, 1 QA |
| **S** | one subsystem | 1 implementer, 1 QA, PR review |
| **M** | multi-file, or a migration, or schema | 1 implementer, 1 QA, PR review **+ security review** |
| **L** | multiple subsystems | **split it into sub-tickets first**, then treat each as S or M |

Security review is mandatory for anything touching custody, the ledger, permissions,
auth, tenancy, or the `/api/*` surface — regardless of size.

There is no published rubric for agents-per-task-size; this table is reasoned from
the constraint above, not received wisdom. Scale writers by **independent modules**,
never by line count.

---

## Stage 2 — Branch

Always cut from `development`, never from whatever is checked out:

```
git checkout development
git pull
git checkout -b feat/<TICKET-ID>-<slug>
```

Confirm the branch before dispatching anyone. An implementer that commits to the
wrong branch costs more to unpick than the feature cost to build.

---

## Stage 3 — Implement

Dispatch **one** implementer per independent module, via the `sti-dev` agent.

Give it: the ticket path, the rules files for its area, `STACK-NOTES.md`, the branch
name, and — critically — **the paths any concurrent agent is editing**, so it does not
misattribute someone else's work in progress.

Require the implementer to invoke the **`minimal-change`** skill before producing any
diff. Mandatory, including for changes that look like one-liners.

---

## Stage 4 — Adversarial QA

Dispatch `sti-qa`. It must be a **different agent** from the implementer, with a fresh
context. That separation is the entire point — an agent cannot adversarially review
its own reasoning.

The QA agent's standing instruction, and the thing that has actually caught defects
here: **try an input the implementer did not.** On 2026-08-16 a CI drift check passed
its author's own evidence and still failed QA, because the verifier tested a *rename*
where the author had only tested an *added column* — the check silently passed on real
drift.

QA is read-only. It never fixes what it finds; a QA agent that patches its own
findings has destroyed the evidence.

On **FAIL**: send the findings back to the *same* implementer via `SendMessage`, so it
keeps its context. Tell it explicitly what QA confirmed as correct, so it does not
churn work that was already right. Then re-run QA.

---

## Stage 5 — Review

Only once QA passes.

1. Open a draft PR against `development` early, with the template in
   `.claude/workflow.config.json`.
2. Dispatch `sti-pr-reviewer` — correctness, standards, tests, performance, contract
   compatibility.
3. Dispatch `sti-security-reviewer` if the size rubric or the touched area requires it.

Both run in fresh contexts and see only the diff and the ticket.

**The discipline both reviewers work under:** report a finding only if you can name
the failing input or cite the violated project rule. Cap at 10 comments. A reviewer
that leaves 14 comments of which 11 are wrong is worse than no reviewer, because
people learn to ignore it.

Post findings to the PR with `gh pr comment`. On CHANGES REQUESTED, hand back to the
implementer and return to Stage 4.

---

## Stage 6 — Record, then hand over

Write the feature record under `docs/features/<TICKET-ID>-<slug>/` per
`docs/features/README.md`. Scale the file count to the ticket size — a config change
does not need four documents, and demanding them is how a convention gets abandoned.

The section that matters most is **deviations from the plan, and why**. That gap is
the only part a future reader cannot reconstruct from the diff.

Then mark the PR ready for review and **stop**.

**You never approve and you never merge.** A human is the sole approver. Report: what
was built, the QA verdict with its evidence, the review findings and how each was
resolved, the judgement calls you are least sure of, and the PR link.

Deep multi-agent review (`/code-review ultra`) is **not part of this workflow**. The
user runs it themselves, once, when all the work is finished. Do not invoke it, do not
prompt for it per ticket or per phase, and never simulate it.

---

## Failure modes to refuse

- **Marking something done because the code looks right.** Run it. Paste real output.
- **Reporting a phase complete with a ticket blocked.** Finish everything unblocked,
  then say plainly what you left and why. Scaling the work down is the user's call.
- **Fixing an adjacent bug you found.** Report it and file a ticket. "While I'm in
  here" is how a two-file change becomes twelve.
- **Letting an agent approve its own work.** The reviewer is never the implementer.
