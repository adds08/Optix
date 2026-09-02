---
name: optix-explain-before-deciding
description: Use whenever you are about to ask the user to make a decision, approve a destructive or unfamiliar action, or choose between options -- especially ones involving jargon, env vars, flags, or commands they didn't introduce themselves. Explain each option first in plain terms before presenting the choice. Triggers on any AskUserQuestion call, or any inline "should I do X or Y" moment in STInventory.
---

# Explain before deciding

## Why this exists

The user (2026-09-03): "whenever there is something like this, especially things
you need my decision, can you explain me in max 5 to 10 sentences as point what it
is, what does it do first?" This followed being asked to decide on `canRunAJob`
(a flag that did not exist yet) and `SEED_RESET=1` (a destructive env var) with no
explanation of either — just the names, dropped into a decision point as if they
were already understood.

The user runs a construction operations business, not a software shop. Jargon,
env vars, flag names and internal identifiers are not obviously interpretable to
them the way they are to an engineer who wrote the code five minutes ago. A
decision point that assumes shared vocabulary is not really offering a decision —
it is asking for a rubber stamp on something unexplained.

## The rule

Before asking the user to decide anything — via `AskUserQuestion`, or inline in
prose ("should I do X or Y?", "want me to run Z?") — explain what is actually being
decided FIRST, as its own step, separate from the question.

For each option or term involved:

- **What it is** — plain language, no unexplained jargon. If a technical name is
  unavoidable (an env var, a flag, a table name), say what it is a name FOR.
- **What it does** — the concrete effect if chosen.
- **Where it touches the system** — name the actual layer: which file, which
  table, which environment (local Docker vs. production), which service. This
  is what lets the user judge blast radius without reading the code themselves.

Keep the whole explanation to 5-10 sentences per item, as bullet points, not
paragraphs. This is a summary that orients, not a technical spec.

**Destructive or irreversible actions get an extra sentence naming the blast
radius explicitly** — what data is affected, and whether it is local-only or
reaches a shared/production system. `SEED_RESET=1` is the worked example: it
resets `packages/db/src/seed.ts`'s target database, and the sentence that
matters is "this only touches your local Docker Postgres container, not
production" plus "it wipes whatever is in that local database right now."

Then ask the actual question.

## What this replaces

The old pattern: introduce a new term inline ("Add `canRunAJob`..."), then a
paragraph later ask the user to decide on it, assuming the earlier mention counted
as an explanation. It did not — a name is not a definition, and stacking the
explanation onto the proposal rather than separating it forces the user to
reverse-engineer what they are agreeing to.

## Where this applies in STInventory specifically

Recurring shapes worth calling out because they've come up before, and will again:

- **New enum values, flags or columns not yet built** (`canRunAJob`, a rank field,
  a new `Permission` string) — say plainly that it does not exist yet, this is a
  proposal, and what table/file it would live in.
- **`SEED_RESET`, `make reset`, `git reset --hard`, any wipe** — always state
  local-vs-shared scope and what is lost.
- **Migrations** (`make generate`, `make migrate`) — state that it touches the
  real schema and is committed, distinct from a seed reset.
- **Anything crossing the local/production boundary** (`DEPLOY.md`, a push to
  `main`) — state explicitly that this is NOT what is being proposed, if it
  isn't, since a push to `main` auto-deploys in this repo.

## Non-goals

This is not license to over-explain routine, reversible, local actions (reading a
file, running a typecheck, adding a test). It is specifically for decision points
— places where the user's input gates what happens next — and specifically for
terms or actions that are not self-evident from plain English.
