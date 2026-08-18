---
name: systematic-debugging
description: Use when encountering any bug, test failure, unexpected behavior, data issue, or infrastructure problem in STInventory, before proposing fixes. Triggers on any debugging scenario -- test failures, wrong register state, unexpected custody, chat messages stuck in a queue, performance problems, build failures, Docker issues, or API errors. Use this ESPECIALLY when under time pressure or when "just one quick fix" seems obvious.
---

# Systematic Debugging (STInventory Edition)

## Available evidence-gathering tools

Before diving into the four phases, know what you have. Don't guess when you can query.

**Bring the stack up** (everything below assumes it is running):
```bash
cp .env.example .env.local        # required; the Makefile hard-errors without it
make ENV=local up                 # postgres + api + web
make ENV=local seed               # 754 tools, 41 people, 16 projects
```

**The database** — the ledger is the source of truth, so go here first:
```bash
make ENV=local psql
# or non-interactively:
docker compose --env-file .env.local exec -T postgres \
  psql -U postgres -d stinventory -c "SELECT ..."
```
High-value queries when custody looks wrong:
```sql
-- the ledger for one tool, in fold order
SELECT id, event_type, occurred_at, to_state FROM transaction
WHERE asset_id = '<uuid>' ORDER BY occurred_at, id;

-- the invariant that has no DB constraint behind it
SELECT asset_id, count(*) FROM assignment
WHERE status = 'active' GROUP BY asset_id HAVING count(*) > 1;

-- events that will silently blank a rebuild
SELECT count(*) FROM transaction WHERE to_state IS NULL;

-- chat messages that never got parsed
SELECT processing_status, intent_type, attempts, error_note
FROM message ORDER BY created_at DESC LIMIT 20;
```

**Logs** — all three workers log to the API container:
```bash
docker logs stinventory-api --tail 100
make ENV=local logs               # follows every service
```
Look for `[messaging-worker]`, `[notifications]`, `[request-worker]`, `[engine]`.

**The API directly** — faster than clicking, and the only way to separate a UI bug
from an API bug:
```bash
TOK=$(curl -s -X POST http://localhost:4100/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@stinventory.local","password":"stinventory-demo"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["sessionId"])')

curl -s http://localhost:4100/trpc/dashboard.kpis \
  -H "Authorization: Bearer $TOK"
```
Log in as `warehouse@` or a foreman instead when the bug is about permissions —
the outcome differs by role by design (`custodyOutcome`).

**The tests** — 139 of them, all pure functions, all fast:
```bash
pnpm test                          # on the host, after a full pnpm install
pnpm --filter @stinventory/domain test
```
If `make ENV=local test` fails with a `TSConfckParseError` about
`@stinventory/config-tsconfig`, that is the Docker volume defect, not your bug —
check `docker-compose.yml` lists a `node_modules` volume for the package in question.

**The browser** — the Playwright MCP for anything visual. The console is normally
clean apart from a missing `favicon.ico`.

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue:
- Test failures
- Bugs in production
- Unexpected behavior
- Performance problems
- Build failures
- Integration issues
- **The register naming the wrong custodian**, or a tool in two places at once
- **A dashboard tile reading zero** when the data is clearly there
- **Chat messages stuck** in `queued`, `processing` or `pending_manual`
- **Docker / compose anomalies** (stale anonymous volumes are a recurring cause)

**Use this ESPECIALLY when:**
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- Previous fix didn't work
- You don't fully understand the issue

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read Error Messages Carefully**
   - Don't skip past errors or warnings
   - They often contain the exact solution
   - Read stack traces completely
   - Note line numbers, file paths, error codes

2. **Reproduce Consistently**
   - Can you trigger it reliably?
   - What are the exact steps?
   - Does it happen every time?
   - If not reproducible -- gather more data, don't guess

3. **Check Recent Changes**
   - What changed that could cause this?
   - Git diff, recent commits
   - New dependencies, config changes
   - Environmental differences

4. **Gather Evidence in Multi-Component Systems**

   **WHEN the system has multiple components.** In this repo the two chains that
   actually break are:

   ```
   web/mobile → tRPC router → custody.ts → asset UPDATE + transaction INSERT → Postgres
                                    ↘ domain rules (custodyOutcome, fold)

   message(queued) → messaging-worker → parseIntent → LLM
                          ↘ entity-resolve → apply-action → ledger
   ```

   Ask at each boundary: what shape went in, what came out, and did the
   `toState` survive intact?

   **BEFORE proposing fixes, add diagnostic instrumentation:**
   ```
   For EACH component boundary:
     - Log what data enters component
     - Log what data exits component
     - Verify environment/config propagation
     - Check state at each layer

   Run once to gather evidence showing WHERE it breaks
   THEN analyze evidence to identify failing component
   THEN investigate that specific component
   ```

   **STInventory-specific: read the ledger, not the projection.** `asset.current_*`
   is a cache. When it disagrees with what people saw happen, the `transaction`
   rows tell you which write was wrong and when. A projection that looks wrong is
   evidence about a *writer*, not a thing to patch in place.

5. **Trace Data Flow**

   See `root-cause-tracing.md` in this directory for the complete backward tracing technique.

   **Quick version:**
   - Where does bad value originate?
   - What called this with bad value?
   - Keep tracing up until you find the source
   - Fix at source, not at symptom

### Phase 2: Pattern Analysis

**Find the pattern before fixing:**

1. **Find Working Examples**
   - Locate similar working code in same codebase
   - What works that's similar to what's broken?

2. **Compare Against References**
   - If implementing pattern, read reference implementation COMPLETELY
   - Don't skim - read every line
   - Understand the pattern fully before applying

3. **Identify Differences**
   - What's different between working and broken?
   - List every difference, however small
   - Don't assume "that can't matter"

4. **Understand Dependencies**
   - What other components does this need?
   - What settings, config, environment?
   - What assumptions does it make?

### Phase 3: Hypothesis and Testing

**Scientific method:**

1. **Form Single Hypothesis**
   - State clearly: "I think X is the root cause because Y"
   - Write it down
   - Be specific, not vague

2. **Test Minimally**
   - Make the SMALLEST possible change to test hypothesis
   - One variable at a time
   - Don't fix multiple things at once

3. **Verify Before Continuing**
   - Did it work? Yes -- Phase 4
   - Didn't work? Form NEW hypothesis
   - DON'T add more fixes on top

4. **When You Don't Know**
   - Say "I don't understand X"
   - Don't pretend to know
   - Ask for help
   - Research more

### Phase 4: Implementation

**Fix the root cause, not the symptom:**

1. **Create Failing Test Case**
   - Simplest possible reproduction
   - Automated test if possible
   - MUST have before fixing

2. **Implement Single Fix**
   - Address the root cause identified
   - ONE change at a time
   - No "while I'm here" improvements
   - No bundled refactoring

3. **Verify Fix**
   - Test passes now?
   - No other tests broken?
   - Issue actually resolved?

4. **If Fix Doesn't Work**
   - STOP
   - Count: How many fixes have you tried?
   - If < 3: Return to Phase 1, re-analyze with new information
   - **If >= 3: STOP and question the architecture (step 5 below)**

5. **If 3+ Fixes Failed: Question Architecture**

   **Pattern indicating architectural problem:**
   - Each fix reveals new shared state/coupling/problem in different place
   - Fixes require "massive refactoring" to implement
   - Each fix creates new symptoms elsewhere

   **STOP and question fundamentals:**
   - Is this pattern fundamentally sound?
   - Are we "sticking with it through sheer inertia"?
   - Should we refactor architecture vs. continue fixing symptoms?

   **Discuss with the team before attempting more fixes**

## Known traps in this codebase

Check these before starting a long investigation — each has bitten before:

| Symptom | Look here first |
|---|---|
| Tests fail only inside Docker | `docker-compose.yml` is missing a `node_modules` anonymous volume for that package |
| A rebuild blanks everything | A writer emitted a partial `toState`; the fold replaces, it does not merge |
| `asset.rebuild` does nothing | Every `transaction.to_state` is NULL — the seed writes them that way |
| Two custodians for one tool | A write bypassed `custody.ts` — check `assignment.approve` and the `/api/*` routes |
| Overdue alert fires a day early | Domain rule uses strict `<`, the notification worker uses `lte` |
| Chat message stuck in `pending_manual` | No LLM configured, or confidence < 0.6, or no asset resolved |
| Chat message stuck in `processing` | Worker died mid-batch; the sweeper re-queues after 5 min |
| A permission check "does nothing" | You may be on the `/api/*` REST surface, which has none |
| Stale deps after a `package.json` change | `make ENV=local reset` — the anonymous volumes survive rebuilds |

## Red Flags -- STOP and Follow Process

If you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- Proposing solutions before tracing data flow
- **"One more fix attempt" (when already tried 2+)**

**ALL of these mean: STOP. Return to Phase 1.**

## Supporting Techniques

Available in this directory:
- **`root-cause-tracing.md`** -- Trace bugs backward through call stack to find original trigger
- **`defense-in-depth.md`** -- Add validation at multiple layers after finding root cause
- **`condition-based-waiting.md`** -- Replace arbitrary timeouts with condition polling

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Root Cause** | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare | Identify differences |
| **3. Hypothesis** | Form theory, test minimally | Confirmed or new hypothesis |
| **4. Implementation** | Create test, fix, verify | Bug resolved, tests pass |
