# docs/concepts — Agent Notes (EVALUATION ONLY)

> **These documents are evaluation, not fact.**
> They were written by an AI agent by reading source, git history and the running
> system. They are a *model of what the code appears to do*, produced at a point
> in time. They can be wrong, out of date, or over-confident.
> **Verify against the code before acting on anything here.** The source is the
> only authority; `git log` is the only record of what changed.

## Audience

Claude, GPT, Gemini and any other LLM/agent asked to work in this repository.
Read this folder to get oriented quickly, then confirm in source.

## What belongs here

- Visual explanations of how the system fits together (flows, charts, state).
- Point-in-time *assessments* of status, risk and open questions.
- Concept notes that are too large for a chat answer.

## What does NOT belong here

- Decisions. Record those in the code/comments if they are load-bearing.
- Anything an agent invented and nobody verified. If it is a guess, label it.

## How to read a concepts document

1. Check the **generated date** and the **evidence** lines (file paths, commits).
2. Treat every claim as a hypothesis until you see the file it cites.
3. If a claim cites no path or commit, it is an opinion — weight it accordingly.
4. Files here may be regenerated wholesale; do not treat them as a changelog.

## Standing caveats for this repo (as of 2026-09-14)

- The product, the package scope, the database, the containers, the dev image and
  the S3 bucket default are all **Optix** now (commit `e908ccd`).
- **Deliberately NOT renamed**, each for a reason: the API-key encryption salt
  (`packages/auth/src/secrets.ts` — a cryptographic input, not a name), the
  `/media/stinventory/stinventory/` storage path in `apps/api/src/storage.ts`
  (a record of a real path bug), throwaway `@stinventory.local` fixture emails,
  and the mobile app-store bundle identifiers.
- There is **no seed**. `make provision` writes the authority model and two
  logins; the register itself is populated by the importers and the BambooHR
  sync. An empty register is the correct starting state.
- The database has **no Row-Level Security**. Tenant isolation is hand-written
  `eq(tenant_id, …)` predicates plus `scope.ts`. Treat that as load-bearing.
- Custody is **event-sourced**: `tbl_ops_transaction` is the system of record,
  `asset.current_*` is a projection, and `custody.ts` is the one writer.
- DB-backed test suites **skip** without `DATABASE_URL`; `db-suites-run.test.ts`
  now prints a loud warning naming the count rather than passing silently.

## Regenerating

This folder is generated/updated by hand from an agent's code read. There is no
build step. When you change the system materially, update the affected concept
document or delete it — a stale concept file is worse than none.
