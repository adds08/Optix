---
name: changelog
description: Record what changed in changelogs/ after any code or file change in STInventory. Use at the end of every task that produced a diff -- implementation, fix, refactor, migration, doc edit -- and whenever the user says "log this", "changelog", "what changed", or asks what happened in a past session. Reconstructs the entry from git rather than from memory.
---

# Changelog

## Why this exists

Work on this repo happens across sessions, branches and parallel agents. Git records
*what* bytes changed; it does not record *why*, what was verified, or what was
deliberately left undone. Commit subjects here have been `#` more than once. The
changelog is the layer that survives a compacted context and a `--continue` — it is
written for the next agent and the next month, not for a release announcement.

## The Iron Law

```
RECONSTRUCT FROM GIT, NEVER FROM MEMORY
```

Your recollection of a long task is lossy and optimistic. Run the commands, read the
actual diff, and write what the diff says. An entry that claims a file was changed
when it was not is worse than no entry.

## When to write one

Write an entry when a task ends and the tree is different than when it started:
code, schema, migrations, docs, config, skills, seeds. One entry per task, not per
file and not per tool call.

Do **not** write an entry for read-only work — an audit with no diff, a question
answered, an investigation that concluded "no change needed". If it produced a
finding worth keeping and no diff, that belongs in a memory or a doc, not here.

## Procedure

### 1. Find out what actually changed

```bash
git status --porcelain                     # uncommitted, staged and not
git diff --stat                            # unstaged shape
git diff --cached --stat                   # staged shape
git log --oneline -5                       # did someone commit mid-task?
git log --oneline --since="4 hours ago"    # parallel sessions land here too
```

Two traps this repo has already hit:

- **Another session may have committed your work.** If `git status` is clean but you
  know you changed files, the diff is in a commit — find it with `git log` and read
  it with `git show --stat`, then write the entry against that.
- **Not every change in the tree is yours.** Parallel agents work in `apps/web`.
  Attribute only what this task touched; note the rest as concurrent activity if it
  matters to the reader.

### 2. Append to the month file

`changelogs/YYYY-MM.md`, e.g. `changelogs/2026-08.md`. Create it if absent with a
single `# YYYY-MM` heading. Newest date section at the **top** of the file, under
that heading — a reader opening the file wants today, not January.

Within a date, append entries in the order they happened.

### 3. The entry shape

```markdown
## 2026-08-24

### One line saying what changed, in the imperative

**Files:** `path/one.ts`, `path/two.tsx` (or "12 files under `apps/web/components`" when the list is long)
**Why:** The problem this solved, and the cause if it was a bug. Not the mechanics — the diff has those.
**Verified:** What you actually ran, and what it printed. "Not verified" is an acceptable and useful value.
**Left undone:** Anything deliberately out of scope, with the reason. Omit the line if nothing was.
**Commit:** `abc1234` if it was committed, otherwise "working tree".
```

Follow the repo's doc voice: why over what, no emojis, no TL;DR, imperative subjects,
and **no counts that will go stale** — "the register pages" not "the 6 register pages".

### 4. Stage it with the change

`changelogs/` is tracked. Stage the month file **by name** alongside the rest of the
work — never `git add -A`; this tree routinely carries root-owned `node_modules/` and
`.turbo/` from container-run make targets.

## Reading it back

When picking up unfamiliar work, `changelogs/` is the cheapest orientation available:

```bash
ls changelogs/                             # what months exist
head -60 changelogs/$(date +%Y-%m).md      # this month, newest first
grep -rn "data-table\|custody.ts" changelogs/   # everything that ever touched a file
```

Prefer it over reconstructing intent from `git log` — that is the whole point of it.

## What it is not

- **Not a substitute for a memory.** A durable preference or a standing instruction
  goes in the memory directory. The changelog is a dated record of events.
- **Not a substitute for docs.** If the change made a document wrong, fix the
  document — CLAUDE.md rule 8. A changelog entry does not discharge that.
- **Not a place for secrets.** No tokens, no keys, no connection strings, no
  `llmApiKeyEnc`.
