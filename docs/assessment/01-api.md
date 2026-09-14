# Technical Assessment — API & Contracts Layer

**Date:** 2026-09-12
**Scope:** `apps/api` (3,683 lines) + `packages/api-contracts` (27,002 lines)
**Stack:** tRPC v11 over Hono, Drizzle ORM, Postgres. Multi-tenant by hand-written `eq(x.tenantId, tid)` predicate — no RLS.
**Method:** mechanical extraction of all 68 query sites lacking a literal tenant predicate, followed by reading every one; router-by-router read; live database verification of the two defects that could be proven.
**Verdict:** **The strongest layer in the system.** Authorization is build-enforced, input validation is airtight, and tenant isolation is far better than a hand-written-predicate design would suggest. Two real defects, one of them user-facing today.


> ⚠ **DATED SNAPSHOT — 2026-09-12, not current state.** See
> [00-summary.md](00-summary.md) for the full list of what has changed since.
> Fixed since: unscoped tenant lookups in `notifications.ts`/`notify.ts`, the `role.create` and vehicle/projectGroup multi-writes (now transactional), and the `resolveByName` N+1 (now memoised). Counts have moved: 170 procedures, 34 unique indexes. **Still open:** `messaging.ts` `from "message"` and `db: any` in `location.ts`.

---

## Correction: the procedure count was wrong

**168 procedures across 29 routers**, not 86.

My earlier count grepped for `Procedure\b`, which misses every procedure declared through `requirePermission(...)` — a helper at `trpc.ts:141` that wraps `protectedProcedure`. The four routers I previously reported as having **zero** procedures in fact have **16** between them:

| Router | Actual procedures |
|---|---|
| `custody-reassign.ts` | 2 (`:22`, `:40`) |
| `role.ts` | 7 (`:78, 90, 201, 227, 263, 343, 391`) |
| `settings.ts` | 4 (`:124, 134, 252, 360`) |
| `sync.ts` | 3 (`:37, 124, 148`) |

Nothing is misfiled or stubbed. The correct grep is:

```
grep -rcE "^\s*\w+:\s*(requirePermission|protectedProcedure|publicProcedure)" packages/api-contracts/src/routers/*.ts
```

---

## Summary table

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `messaging.messages` pagination references a renamed table | **HIGH** | CONFIRMED — proven against live DB |
| 2 | Four multi-write mutations can half-commit | **HIGH** | CONFIRMED |
| 3 | `bamboo-sync` is an N+1 over the whole roster | MEDIUM | CONFIRMED |
| 4 | `notifications.ts:92` unscoped employee lookup | MEDIUM | CONFIRMED (not exploitable today) |
| 5 | `notify.ts:41` unscoped user lookup | MEDIUM | CONFIRMED (not exploitable today) |
| 6 | `db: any` defeats the `Transaction` compile-time guard | MEDIUM | CONFIRMED |
| 7 | Notifications inserted one row at a time | LOW | CONFIRMED |
| 8 | `entity-resolve.ts` issues a query per token | LOW | CONFIRMED |
| 9 | Unique-violation handling covers 1 of 24 constraints | LOW | CONFIRMED (UX, not security) |
| — | Authorization: build-enforced, no gaps | — | CONFIRMED STRENGTH |
| — | Input validation: no `z.any()`, no passthrough | — | CONFIRMED STRENGTH |
| — | Error formatter does not leak schema | — | CONFIRMED STRENGTH |
| — | Tenant isolation: no exploitable cross-tenant read | — | CONFIRMED STRENGTH |

---

## Finding 1 — Chat pagination is broken (HIGH, user-facing)

**CONFIRMED — proven against the live database, not inferred.**

`packages/api-contracts/src/routers/messaging.ts:95`:

```ts
conditions.push(lt(schema.message.createdAt,
  sql`(select created_at from "message" where id = ${input.cursor})`));
```

Migration `packages/db/drizzle/0029_table_naming_convention.sql:42` renamed
`message` → `tbl_ops_message`. This raw-SQL subquery was never updated. Proof:

```
$ psql -c 'select created_at from "message" limit 1;'
ERROR:  relation "message" does not exist
```

**Consequence.** Any call passing `cursor` throws → INTERNAL_SERVER_ERROR → the
user sees "Something went wrong on our side." **Chat history beyond the first 50
messages is unreachable for every user in every tenant.**

**Why nobody has reported it.** No web caller currently passes `cursor` (grepped
`apps/web` — zero hits), and no test covers the paginated path. So the feature is
shipped, broken, and unused. It will break the first time anyone builds
scroll-back, or the first time a channel exceeds 50 messages and someone looks
for older ones.

This is the **only** remaining raw bare-table-name reference in the API; every
other query goes through `schema.*`. One-line fix.

---

## Finding 2 — Four multi-write mutations can half-commit (HIGH)

**CONFIRMED.** None of these wrap their writes in `ctx.db.transaction`:

| Location | Writes | Failure leaves |
|---|---|---|
| `routers/location.ts:723` `vehicle.create` | `location` (`:775`) then `vehicle` (`:791`) | An orphan `location` row of type `vehicle` with no vehicle — a **phantom container in every location picker** |
| `routers/location.ts:964` `vehicle.delete` | `vehicle` (`:1000`) then `location` (`:1001`) | An orphan location row |
| `routers/projectGroup.ts:128` `create` | `projectGroup` → `projectGroupProject` → `projectGroupUser` | A group with partial membership |
| `routers/role.ts:343` `create` | `role` then `rolePermission` | A role with no permissions |

**The projectGroup case is the most dangerous.** `scope.ts:151` derives project
visibility from exactly these rows, so a half-committed group **silently narrows
what a PM can see** — another confident wrong answer, with no error surfaced.

The `role.create` case produces an account that, per the test's own note at
`rbac-matrix.test.ts:211`, "can log in and do nothing."

Additionally, `projectGroup.setProjects:208` and `setUsers:228` do
delete-then-insert **without** a transaction — a mid-way failure empties a
group's membership entirely.

**The fix already exists in the codebase.** `role.setPermissions:311` performs
the identical delete-then-insert pattern **inside** `ctx.db.transaction`. That is
the template; it is simply applied inconsistently.

Note that `location.ts:999` carries a comment about *ordering* ("Vehicle first,
then its location: the FK points that way") — so the write order was reasoned
about, but atomicity was not.

---

## Findings 3, 7, 8 — Performance (N+1 patterns)

**3 — `bamboo-sync` (MEDIUM).** `apps/api/src/bamboo-sync.ts:560` loops
`plan.people`, issuing up to 3 `resolveByName` calls per person (`:567`, `:570`,
`:573`), each itself 1–3 queries (`:494`: select, conditional insert, re-select),
plus a per-person employee upsert and a delete+insert of contacts.

For a 500-person roster: **~2,000–4,000 sequential round-trips.**

`resolveByName` resolves division / department / job title — a **small, highly
repeated set** — with no memoization. A `Map` cache outside the loop removes
nearly all of it. Roughly a 10× reduction for a few lines of code.

The sync is deliberately non-transactional (documented at `:520`), which is the
right call for a long-running import. This is purely latency.

**7 — Notification inserts (LOW).** `notify.ts:63` and `:134` loop and `await
db.insert(...)` per recipient. The desk fan-out at `:134` hits every active
employee holding the approver role, one INSERT each, **inside the request path**
of `transfer.approve` / `assignment.approve`. Trivially a single multi-row
`.values([...])`.

**8 — `entity-resolve.ts` (LOW).** `apps/api/src/entity-resolve.ts:40` loops
tokens querying `employee` (`:42`), `project` (`:50`), `location` (`:55`), with
three more near-identical loops at `:106`, `:128`, `:145`. A chat message of N
words costs up to **3N queries** on the message-processing hot path.

---

## Findings 4 & 5 — Two unscoped lookups (MEDIUM, not currently exploitable)

**CONFIRMED as inconsistencies; traced as not currently reachable.**

**`apps/api/src/notifications.ts:92`:**
```ts
.from(schema.employee).where(eq(schema.employee.id, n.recipientEmployeeId))
```
No tenant predicate — despite `n.tenantId` being selected at `:68` and used for
`tenantSettings` two lines earlier at `:78`.

**`packages/api-contracts/src/notify.ts:41`:** resolves `user.employeeId` by id
with no tenant predicate, though `d.tenantId` is in scope and used at `:64`.

**Why not a live leak.** In both cases the id originates from a tenant-scoped
set, so today no cross-tenant value can reach them.

**Why they still matter.** `routers/assignment.ts:292-296` carries a long comment
explaining that the tenant-predicate rule has **no exceptions**, specifically so
that an unscoped lookup never becomes "the template that gets copied." These two
are that template. Both have `tenantId` already in scope — the fix is a few
characters each.

The reasoning that they are safe depends entirely on the call graph staying as it
is. That is an argument for fixing them, not for documenting them as safe.

---

## Finding 6 — `db: any` defeats the `Transaction` guard (MEDIUM)

**CONFIRMED.** `custody.ts` deliberately types its handle as `Transaction`
(`:60`, `:143`) so that passing a raw pool handle is a **compile error** — this
is the guard that prevents the close-without-open bug class the file documents.

That guarantee is locally defeated by `any`-typed handles in its largest callers:

```
apply-action.ts:118, :588, :721
project-assign.ts:47, :144        (async (tx: any))
notify.ts:32, :111
routers/messaging.ts:26
routers/category.ts:29
```

Inside these, passing a pool handle where a transaction is required **compiles
fine**.

The codebase knows: `apply-action.ts:249` contains a comment noting a bug that was
"only surfaced when `db: any` became a real type."

**Consequence.** The compile-time guard protects `custody.ts`'s own signature but
not the call sites most likely to misuse it.

---

## Finding 9 — Unique-violation coverage is 1 of 24 (LOW, UX not security)

**CONFIRMED.** The schema declares **24** `uniqueIndex` constraints. Exactly one
has a 23505 handler: `routers/user.ts:129-131`, for `user_tenant_email_uq`.

Every other collision — duplicate project code, duplicate vehicle unit, the
`one_primary_uq` partial index on `employeeContact`, the STI-103 partial unique on
active assignments — surfaces as an unmapped INTERNAL_SERVER_ERROR.

**Not a leak.** `trpc.ts:110-118` redacts all internal errors to a fixed string
and nulls `userMessage`, so no schema detail reaches a client. Several paths also
pre-check (`projectTeam.ts:1217`, `location.ts:972`, `import.ts:71`).

**Consequence is purely UX:** a user entering a duplicate vehicle unit number
gets "Something went wrong on our side" instead of "that unit already exists."

---

## Confirmed strengths

**Authorization is build-enforced — the strongest thing in this codebase.**
`rbac-matrix.test.ts:537` walks `appRouter._def.procedures` **at runtime** and
**fails the build** on any mutation lacking `meta.permission`, unless it appears
in the `BARE_BY_DESIGN` allowlist (`:495`) where each entry carries a written
justification. A second test (`:546`) fails on *stale* allowlist entries, so the
allowlist cannot become a hiding place.

Every destructive procedure is gated: `vehicle.delete` → `vehicle.manage`,
`teamRole.delete` → `project.team.manage`, `role.delete` → `config.manage`,
`custody-reassign.reassign` → `custody.reassign` (with a comment at `:14-20`
explaining why it is deliberately *not* `assignment.approve`).

**Input validation is airtight.** Zero `z.any()`, zero `z.unknown()`, zero
`.passthrough()` across both packages. IDs are consistently `z.string().uuid()`.
Enums are real enums. The two `z.record` uses are appropriate and bounded. The one
deliberate loosening is VIN (`location.ts:737`), with a comment explaining that
refusing it loses a whole vehicle record over a typo.

**The error formatter does not leak.** `trpc.ts:63-125` redacts both `message`
and `userMessage` on internal errors, separates hand-written `superRefine`
messages (shown) from library-generated Zod text (replaced), and preserves detail
in `zodError`. The comment at `:100-106` documents the exact prior leak — a raw
`violates foreign key constraint "assignment_truck_fk"` reaching a desk user —
and the fix.

**Tenant isolation is largely solved despite the hand-written design.** All 68
query sites lacking a literal tenant predicate were extracted and read:

- **~40 false positives** — predicate lives in a `conditions`/`where` array built earlier
- **~15 structurally exempt** — `userRole`, `rolePermission`, `teamRoleAssigner`, `permission` have **no `tenantId` column at all**; they are join tables reached via a parent already proven in-tenant
- **2 deliberate and documented** — `user.ts:341`, `user.ts:450`, both labeled "Deliberately UNSCOPED" for cross-tenant email-uniqueness refusal
- **~10 cross-tenant sweepers** in workers, correct by design

That leaves **only findings 4 and 5** as genuine gaps, neither currently
reachable. **No exploitable cross-tenant read exists in any router.**

`scope.ts` deserves specific mention: `MATCHES_NOTHING = sql\`false\`` at `:64`
exists precisely so an empty tier can never degrade into "no filter" — the exact
failure mode that would otherwise turn a scoping bug into a data leak.

---

## Deliberate design that should NOT be "fixed"

`packages/api-contracts/src/apply-action.ts:173` loops `assetIds`, giving **each
asset its own transaction** with three `findFirst` calls apiece. This looks like
an N+1 and is not a defect — it is documented at `:180-190`: a 5-asset bulk
action that fails on the third **must leave the first two applied**. Ledger-based
idempotency (`refMessageId`) makes retry safe.

Collapsing this into one transaction would reintroduce the connection-pinning
problem that `approve.ts` documents. **Leave it alone.**

Likewise the worker-layer queries (`messaging-worker.ts:37,50,67`,
`request-worker.ts:71,132,151,224,285,360`) carry no tenant predicate **by
design** — they are cross-tenant sweepers keyed by `processingStatus`. These
files should be explicitly marked as exempt so a future reader does not copy the
pattern into a request-scoped path.

---

## Recommended actions, in order

1. **Fix `messaging.ts:95`** — one line; currently a hard 500 on a user-facing path.
2. **Wrap the four mutations in transactions** (finding 2) — `location.ts:723`, `location.ts:964`, `projectGroup.ts:128`, `projectGroup.ts:208/228`. Copy the pattern from `role.ts:311`.
3. **Memoize `resolveByName`** (finding 3) — largest available performance win, ~10× fewer round-trips on sync.
4. **Add tenant predicates at `notifications.ts:92` and `notify.ts:41`** (findings 4, 5) — a few characters each; preserves the no-exceptions rule the codebase depends on.
5. **Batch the notification inserts** (finding 7), then tighten the `db: any` signatures (finding 6).
6. Map unique-violation errors for the handful of constraints users actually hit (finding 9) — project code, vehicle unit.
