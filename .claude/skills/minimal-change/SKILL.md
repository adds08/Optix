---
name: minimal-change
description: Use before writing or approving any code change in STInventory -- during planning, implementation, and code review. Enforces blast-radius-first analysis and the smallest change that actually solves the problem. Triggers on "implement", "add", "build", "fix", "refactor", "review this PR", "plan this", or any request that will produce a diff. Use ESPECIALLY when the obvious move is a new package, a new abstraction, or a new dependency.
---

# Minimal Change

Adapted from the ponytail plugin (https://github.com/dietrichgebert/ponytail,
MIT), reworked for STInventory's monorepo and its event-sourced core.

## The point

The best code is the code you never wrote. Every line added to `apps/`,
`packages/api-contracts` or `packages/domain` is a line someone maintains,
reviews, migrates and eventually debugs while a foreman is standing in a yard
waiting to know where a tool is.

This skill is about being **lazy with the solution, never with the reading.**
It never licenses skipping investigation. Understand the problem completely,
then choose the smallest rung that solves it.

## The Iron Law

```
BLAST RADIUS BEFORE DIFF
```

You cannot propose a change until you can name what it touches. This is a
monorepo with a typed spine: one enum in `packages/types` reaches the Drizzle
schema, every tRPC router, and both clients. "It's just a small change" is a
claim to be verified, not an assumption.

## Phase 1: Blast radius

Before writing anything, answer all four:

1. **What calls this?** Search the whole workspace, not just the package you are
   in. `rg "<symbol>" apps packages --glob '!node_modules'` is the cheap version.
   Remember `packages/*` are consumed by *both* `apps/web` and `apps/mobile`.
2. **What does this call?** Which tables, which workers, the LLM endpoint,
   the storage bucket.
3. **What is the contract?** In this repo a contract is one of:
   - a **tRPC procedure** — the type flows straight into both clients, so a shape
     change is a client change, caught by `pnpm typecheck` and nowhere else at runtime
   - a **Drizzle schema** change — needs a paired migration in `packages/db/drizzle`
   - an **enum in `packages/types`** — the DB columns are plain `text`, so the
     database will *not* stop you writing a value you forgot to add
   - an **intent in `packages/intent/src/catalog.ts`** — adding one may also need a
     `case` in the `apply-action.ts` switch, or it throws at runtime
   - the **`toState` snapshot shape** — see the non-negotiables below
4. **What breaks if I am wrong?** A dashboard tile reads zero, or the register
   names the wrong custodian for a $4,000 tool nobody can find? Scale the caution
   to the answer.

Write the answers down. If you cannot answer 1 or 3, you are not ready.

## Phase 2: The ladder

Walk down. Stop at the first rung that solves the whole problem.

| Rung | Ask | STInventory-specific |
|---|---|---|
| 0 | **Does this need to exist?** | The request may describe a symptom whose cause is upstream. A wrong dashboard number is usually a bad ledger write, not a bad query. |
| 1 | **Already in this package?** | Check for the near-identical helper first. This repo has shipped real duplicates — see below. |
| 2 | **Already in `packages/`?** | `domain` has the rules, `types` has the enums and formatters, `custody.ts` has the custody writes. Reach for them before writing a new one. |
| 3 | **Stdlib / language?** | JS stdlib and TS types before a helper module. |
| 4 | **Platform feature?** | Postgres has partial unique indexes, generated columns and `ON CONFLICT`. Drizzle has `db.transaction`. Zod has `.superRefine`. Let the engine do it. |
| 5 | **Installed dependency?** | Check the relevant `package.json` before adding anything — and remember a new dep means a new line in `docker/Dockerfile.dev`'s COPY list and possibly a new anonymous volume in `docker-compose.yml`. |
| 6 | **One line?** | Then one line. Do not grow it to look thorough. |
| 7 | **Minimum that works** | Only now. |

A rung you skipped is a decision you owe the reviewer an explanation for.

### Duplication this repo has actually paid for

Use these as the argument when someone says "I'll just write a new one":

- **`asset.rebuild` reimplements the fold inline** (`routers/asset.ts:450-459`)
  instead of calling `foldAssetState` from `packages/domain`. The tested
  implementation and the production one are now different code that merely agree.
- **`packages/frontend-shared` and `packages/design-system` are dead** — imported
  by nothing. The live theming lives in `apps/web/lib/themes`.
- **The `/api/*` REST surface** duplicates tRPC procedures, without their
  permission checks or ledger writes. It is dead code with a live auth middleware.

## What this skill never trims

Non-negotiable regardless of intensity:

- **A complete `toState` on every ledger write.** The fold replaces rather than
  merges, so a partial snapshot means "custodian, project and location are now
  undefined". This has shipped before; `packages/domain/src/fold.test.ts:114-135`
  pins it.
- **Custody writes go through `packages/api-contracts/src/custody.ts`.** Never
  insert or update an `assignment` row directly. Since STI-103 the partial unique
  index `assignment_one_active_uq` is a backstop, so a bypass throws instead of
  silently producing two custodians — but the index cannot close the previously
  active row, so that file is still the only thing that makes custody correct.
- **Tenant scoping.** Every query carries `eq(table.tenantId, tid)`. There is no
  RLS. The `WHERE` clause *is* the isolation.
- **A permission on every procedure.** `requirePermission(...)` or a documented
  in-body check. A bare `protectedProcedure` that mutates needs a reason in the diff.
- **Secrets handling.** Tenant LLM keys are AES-GCM encrypted at rest and never
  returned to a client. Never add a procedure that returns `llmApiKeyEnc`.
- **Tests for the behaviour you changed.** Fewer lines of implementation, not
  fewer lines of proof. The pure packages (`domain`, `types`, `intent`) are
  trivially testable — there is no excuse there.

If minimalism and one of these conflict, minimalism loses. Say so out loud.

## Phase 3: Justify the size

Before opening a PR, state in the description:

- The rung you stopped at, and why the rung above it did not suffice.
- The blast radius you found in Phase 1.
- Anything you deliberately did NOT do, and why.

A diff that cannot explain its own size is a diff that has not been thought
about.

## Applying this in review

When reviewing a PR, flag:

- **New abstraction with one caller.** Inline it until there are three.
- **A second way to write custody.** The single most expensive pattern in this
  codebase historically — it is why `custody.ts` exists.
- **A partial `toState`.** Reject on sight.
- **A query without a tenant predicate.**
- **Config/flags nobody asked for.** Speculative generality.
- **Wrapper functions that only rename.** Delete the wrapper.
- **Defensive branches for states that cannot occur.** Prove the state is
  reachable or drop the branch.

Phrase findings as deletions with a reason, not as style opinions. "This
30-line resolver has one caller and `formatAssetModel` already does it" is
actionable. "Too complex" is not.

## Red flags in your own thinking

| Thought | Reality |
|---|---|
| "While I'm in here..." | Separate PR. Separate review. |
| "We'll probably need this later" | You do not know that. YAGNI. |
| "A base class would be cleaner" | With one subclass it is indirection, not design. |
| "Let me add a flag to be safe" | An untested branch is not safety. |
| "It's cleaner as its own package" | This repo already carries two packages nobody imports. |
| "I'll just update the projection directly" | Then the ledger and the register disagree. Write the event. |
| "The plan says write a new X" | Plans are written before the code is read. Say so and adjust. |

## Honest note on the source

The ponytail project reports large reductions in generated code on its own
benchmark — roughly half, on twelve tasks against one open-source repo. Those
are the author's self-reported figures on a codebase unlike ours; treat the
approach as sound and the specific numbers as unverified here. What transfers
is the ladder and the discipline, not the percentages.
