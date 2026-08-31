# Commit messages stop naming the tool that typed them

Every commit and pull request this project has taken from an agent session has carried a
`Co-Authored-By: Claude ...` trailer, and every PR body a "Generated with Claude Code" line
with an emoji. Neither was asked for and neither says anything about the change. They are
now banned, and the ban is written where it will actually be read.

## What changed

`CLAUDE.md`'s Conventions section gains the rule: no agent attribution in commits or pull
requests, no trailer, no generated-by line, no emoji. A commit message is an imperative
subject, a blank line, and prose explaining why — and it ends on the last paragraph.

The rule says out loud that agent harnesses append these **by default, on their own
instructions**, and that this repo overrides that. Without naming the conflict the rule
reads as a preference somebody might reasonably not have noticed; naming it makes clear it
has to be actively undone before committing, not corrected afterwards.

## What was found while building it

**The instruction came from this project's own memory.** The assistant's stored note on
STInventory's writing style listed "`Co-Authored-By` trailer" as one of the repo's commit
conventions — so the trailer was not harness default leaking through, it was a rule being
followed faithfully from a file that had it wrong. That memory has been corrected, which is
the half of this fix that stops it recurring in a fresh session.

That is worth recording beyond this change: a wrong entry in a memory or a rules file is
obeyed confidently and indefinitely, and it looks like intent rather than error from the
outside. It is the same failure mode `.claude/rules/` is called out for under behaviour
rule 9, arriving through a different door.

**Nothing in the repository ever asked for it.** No pull-request template, no contributing
guide, no line in `AGENTS.md` or `docs/changelogs/README.md`. There was nothing to remove —
only something to add, so the next agent has a repo-level rule to point at rather than
relying on a memory only one assistant can read.

### DEPLOY.md described a flow that has destroyed production files twice

Folded into this change because it is the same defect in the same category: a document
confidently instructing somebody to do the wrong thing.

The "Redeploy after a code change" section documented an `rsync -az --delete` from a laptop
working copy. `docker/deploy.sh` replaced that flow and says in its own header that it did so
because `--delete` *"twice deleted files that live only here (`.env.production`, the Expo
export)"* — it cannot tell "removed from the repo" from "never in the repo". The section also
pointed at an exclude file at `/tmp/sti-rsync-exclude` which exists on nobody's machine, so
following the instructions verbatim either failed outright or destroyed production
configuration.

It was found the only way this kind of thing is found: by following it. Asked to deploy, the
obvious move was to run what the deployment document said to run.

The section is replaced with what actually happens — merging to `main` **is** the deploy, CI
runs the gated `deploy` job, the key is restricted server-side to `docker/deploy.sh`, and the
script rolls back if `/health` never answers — plus the by-hand invocation for recovering
from a failed run. The old flow is kept as a named warning rather than deleted silently, so
that anybody who remembers it learns why it went.

## Verified

Grepped the repository for `Co-Authored-By`, "Generated with" and the robot emoji across
`.github/`, `AGENTS.md`, `CLAUDE.md` and `docs/changelogs/README.md`: no template or
convention doc contained them, so `CLAUDE.md` is the only place the rule needed to land.

The DEPLOY.md rewrite was checked against the things it describes rather than from memory:
`.github/workflows/ci.yml` for the `deploy` job's `refs/heads/main` gate and its restricted
SSH invocation, and `docker/deploy.sh` for the fetch, the `git reset --hard`, the Caddy
restart, the five-minute `/health` poll and the rollback. The last `rsync` reference
elsewhere in the file was corrected too.

This entry and the commit carrying it are the first to follow the rule.

**Not verified:** nothing executable changed, so there is nothing to run. No typecheck or
test run is meaningful for a documentation-only diff.

## Deliberately not done

**The trailers already in the history were left alone.** They are on `main` in merged
commits, and rewriting merged history to tidy a trailer is far more disruptive than the
trailer is. The rule applies from here.

**No commit hook was added.** A `commit-msg` hook rejecting the trailer would enforce this
mechanically, but it would also fire on every human commit and on rebases of older history,
and the rule is one line to follow. Worth revisiting only if it recurs.

## Where it is

Branch `docs/no-agent-attribution`, off `main`. Documentation only — no code, no schema, no
migration.

**Not deployed**, and nothing to deploy.
