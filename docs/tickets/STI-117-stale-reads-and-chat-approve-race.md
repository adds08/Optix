# STI-117 — Three reads that escaped the lock discipline

**Phase:** 1 — Custody trail
**Size:** 1 unit
**Status:** READY
**Found by:** the STI-109/112/114 implementer on 2026-08-18, reported and deliberately
not fixed because STI-109 forbade restructuring the approve paths. Item 2 confirmed by
the lead by reading `packages/api-contracts/src/routers/assignment.ts:234`.

---

## Why this exists

STI-109/112/114 established one shape across all five custody decision procedures: lock
the **asset row** first, re-read status under that lock, then write. Three reads did not
make it inside that discipline. None is a correctness failure today; all three are the
shape that becomes one.

## Defect 1 — `transfer.approve` reads the asset outside its transaction

`packages/api-contracts/src/routers/transfer.ts:~241` reads the asset before the
transaction opens, to supply `toProjectId` / `toLocationId` fallbacks and `fromState`.
Under a cross-path race — a `return` committing between that read and the transaction —
the approve writes a `fromState` describing custody that has already changed.

This is the same defect class STI-112 fixed in `transfer.decline`, where a stale
`from = to` event would become the ledger's newest snapshot and a rebuild would apply it.
The decline path was fixed; the approve path was out of scope.

## Defect 2 — a read with no tenant predicate

`packages/api-contracts/src/routers/assignment.ts:234`:

```ts
const asset = await ctx.db.query.asset.findFirst({ where: eq(schema.asset.id, a.assetId) });
```

No `eq(schema.asset.tenantId, …)`. `CLAUDE.md` non-negotiable 3 is absolute: every query
carries the tenant predicate, because there is no RLS and the `WHERE` clause *is* the
isolation.

**Be honest about severity when fixing this:** it is read-only, feeds a notification, and
`a.assetId` came from an assignment row that *was* tenant-scoped — so there is no known
way to make it leak today. It is worth fixing because the rule's value is that it has no
exceptions to reason about, and because this line is a template someone will copy into a
query where it does matter.

Grep for the same shape elsewhere while you are here, and report what you find.

## Defect 3 — the chat approve surfaces have the pre-lock guard STI-109 removed

**There are TWO functions here, and the first version of this ticket named only one.**
That error cost a QA round: the implementer fixed `approveTaskAction` exactly as
specified, and the surface the rationale below actually describes was left untouched.

| Function | Reached from | Status |
|---|---|---|
| `approveTaskAction` (`approve.ts:~46`) | `task.approve`, `inbox.resolve` | the one the original ticket pointed at |
| **`confirmMessageAction`** (`approve.ts:182-262`) | **the chat Confirm button** — `apps/web/app/(app)/chat/page.tsx:150`, `apps/mobile/.../handoff.tsx:65` | **the one the rationale means** |

Both check status **before** the transaction that `applyChatAction` uses to write ledger
events — exactly the shape STI-109 fixed in the two custody approve paths. A double-tapped
confirm is the same duplicate-ledger-event race, in the same append-only ledger that can
never be pruned.

This is the most likely of the three to be hit by a real user, because tapping a chat
confirmation twice is an ordinary thing to do on a phone with a slow connection. QA
demonstrated it in a browser: two clicks produced two `assign` ledger rows and two
assignment rows, the first closed as `"transferred"` — a transfer that never happened, now
permanent in the record.

### Do not fix this by wrapping `applyChatAction` in an outer transaction

The obvious fix is a regression. `applyChatAction` takes the raw `db` handle and opens its
**own** transaction (`apply-action.ts:241`), so an outer transaction holds one pool
connection while the inner work needs a second. The pool is `max: 10`
(`packages/db/src/index.ts`). Ten concurrent approves on ten *distinct* rows hold every
connection while each waits for an eleventh.

QA produced exactly this and it never recovers — Postgres reports `blocked_on_locks: 0`,
because it is client-side pool starvation that the deadlock detector cannot see, and the
shared pool means every other API request starves with it.

**Use claim-then-act instead:** a short transaction that locks the row, re-checks status and
claims it, then commits; `applyChatAction` outside any transaction; a short transaction to
finish. The whole race lives in the first step, which is why that step can be short.

## Acceptance criteria

1. `transfer.approve` reads the asset inside its transaction, after the asset-row lock,
   matching the shape STI-109/112/114 established. `fromState` is built from that read.
2. `assignment.ts:234` carries a tenant predicate. Any other untenanted read found by the
   grep is listed in the report — fix them only if they are in these two routers.
3. `approve.ts` re-checks status inside the transaction that writes, and a second confirm
   raises `CONFLICT` rather than writing a second ledger event.
4. A test racing two chat confirms, asserting exactly one ledger event. STI-109's
   `custody-concurrency.test.ts` has the pattern to copy.
5. The existing suite stays green — in particular `custody-concurrency.test.ts`,
   `decline.test.ts`, `custody.test.ts`, `ledger-append-only.test.ts` and
   `seeded-ledger-fold.test.ts`.

## Related

- **STI-109** — established the re-check-under-lock convention this ticket extends.
- **STI-112** — fixed the stale-read half of defect 1 in `transfer.decline`.

## Files

- `packages/api-contracts/src/routers/transfer.ts:~241`
- `packages/api-contracts/src/routers/assignment.ts:234`
- `packages/api-contracts/src/approve.ts:~46`
