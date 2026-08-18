# STI-403 — Idempotent loader with adopt-by-natural-key

**Phase:** 4 — Foundation entity load
**Size:** 2 units
**Status:** BLOCKED by STI-402

---

## Why this exists

`SYSTEM_PLAN.md` §6.4. The one-time load must be built as the mechanism every later
load uses. Re-running it **updates; it never duplicates.**

## Acceptance criteria

1. Keyed on `external_ref(system, type, native_id)`. An existing match is diffed and
   updated; unchanged rows are skipped without a write.
2. **Adoption**: a fuzzy natural-key match against a row with **no** `external_ref`
   attaches the ref rather than creating a duplicate. A match against a row carrying
   a *different* ref is a conflict — reported, never merged.
3. **Unmatched rows are surfaced, never dropped.** §6.4 is explicit. A loader that
   silently discards is worse than one that fails, because the gap is invisible.
4. A report of created / updated / unmatched, shown to the operator before and after.
5. Every change writes a ledger event — `synced` for updates, `imported` for creates
   (§6.4, §9: every custody-affecting change writes an event, including
   administrative corrections).
6. **Idempotency proven by running the same export twice** and showing the second run
   creates nothing and updates nothing. This is the acceptance criterion; a code
   review cannot substitute.
7. One transaction, all-or-nothing, matching the existing import
   (`packages/api-contracts/src/routers/import.ts:269`) — which already does this
   correctly and is the pattern to copy.
8. Reachable from a screen. A loader run by hand from a shell is not delivered.
9. Tests for: create, update, adopt, conflict, unmatched, and re-run.

## The fuzzy match is the risk

§6.4 specifies matching on "name + job number" for pre-existing rows. Fuzzy matching
that is too eager silently merges two real people or two real jobs, and because the
result looks like a successful adoption, nobody finds out.

Bias hard toward reporting a conflict over guessing a match. Make the threshold
explicit and configurable, and state in the report *why* each adoption was made so an
operator can audit it.

## Files

- `packages/api-contracts/src/routers/import.ts:16-30,269` — the transactional
  precedent and its rationale
- `packages/types/src/import-specs.ts` — existing column specs
- `packages/api-contracts/src/index.ts:26-51` — router registration
