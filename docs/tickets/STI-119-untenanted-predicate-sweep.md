# STI-119 — Sweep the queries that don't carry a tenant predicate

**Phase:** 1 — Custody trail (follow-up)
**Size:** 1 unit
**Status:** **DONE — 2026-08-22.** Twenty-three writes carried no tenant predicate: nineteen in the routers and **four in `apps/api` that a first pass missed entirely**, because the sweep only scanned one package and reported clean. All now carry it. The two real exceptions — the background workers (no session, tenant-agnostic queue) and the login lookup (the tenant is an OUTPUT of the credential check) — are documented at their call sites, exempted with reasons in the test, and written up as a rule in `.claude/rules/database.md` (AC 4). `packages/api-contracts/src/tenant-predicate.test.ts` now scans BOTH roots and fails the build on a twenty-fourth.
**Found by:** the STI-117 implementer on 2026-08-18, running the grep that ticket's
criterion 2 required. The two writes were confirmed by the lead.

---

## Why this exists

`CLAUDE.md` non-negotiable 3: *"Every query carries `eq(table.tenantId, tid)`. There is
no RLS. The `WHERE` clause **is** the isolation."*

STI-117 fixed the one instance inside its own routers. The grep found more, spread
across `apps/api`. None is known to be exploitable today — every one of them derives
its id from a row that *was* tenant-scoped. **Do not write this up as a
vulnerability**, and do not let anyone fix it in a panic.

Fix it because the rule's entire value is that it has no exceptions to reason about.
Right now a reader has to evaluate, case by case, whether the id "came from somewhere
safe" — and that judgement is exactly what fails when someone copies one of these
lines into a query where the id came from a request body.

## The writes — fix these first

`apps/api/src/index.ts:~162` and `~188`, the photo upload and delete handlers:

```ts
const asset = await db.query.asset.findFirst({
  where: and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, session.tenantId)),
});          // ← the check IS tenant-scoped
...
await db.update(schema.asset)
  .set({ photoKey: key, updatedAt: new Date() })
  .where(eq(schema.asset.id, assetId));   // ← the write is NOT
```

Check-then-act, where the check carries the tenant and the act does not. Safe as
written, because you cannot pass the check with another tenant's id. It is worth
fixing anyway: the safety lives in the distance between two statements rather than in
the statement that does the damage, and these are **writes**, not reads.

## The reads

| Location | Query | Where the id comes from |
|---|---|---|
| `apps/api/src/messaging-worker.ts:~122` | `project.findFirst({ where: eq(project.id, emp.primaryProjectId) })` | a tenant-scoped `employee` row |
| `apps/api/src/entity-resolve.ts:~87` | `asset.findFirst({ where: eq(asset.id, m.id) })` | tenant-scoped `matchEntity` |
| `packages/api-contracts/src/routers/assignment.ts:234` | — | **already fixed by STI-117** |

## The one legitimate exception — document, do not "fix"

`apps/api/src/index.ts:~86`, the login path:

```ts
user.findFirst({ where: eq(schema.user.id, result.userId) })
```

**The tenant is derived *from* this row.** There is no tenant to filter by yet — adding
one would be circular. This is a real exception to non-negotiable 3, and it is
currently undocumented, which means the next person either "fixes" it into nonsense or
cites it as precedent for skipping the predicate elsewhere.

Give it a comment saying why it is exempt. That comment is the most valuable line in
this ticket.

## Acceptance criteria

1. The two photo-handler writes carry a tenant predicate.
2. The two reads above carry a tenant predicate.
3. The login read carries a **comment** explaining why it cannot and must not.
4. A decision, recorded, on the long tail: there are many `update … where eq(x.id, id)`
   statements (inbox, messaging, task, category, projectGroup, location, and the
   workers) where the id was fetched tenant-scoped a few lines above. The workers
   legitimately iterate across tenants by design.
   **Decide whether the rule is enforced literally everywhere or only at trust
   boundaries, and write the answer into `.claude/rules/database.md`.** Right now the
   rule reads as absolute while the code is not, and that gap is what produces both
   false review findings and real misses.
5. Do **not** convert the workers' deliberate cross-tenant iteration into
   tenant-scoped queries. That would break them. Name them in the rule as the
   documented exception.

## Explicitly not in scope

Do not attempt to add RLS. That is a much larger change with its own migration and
connection-role implications, and this ticket is about making the existing rule
truthful, not replacing it.

## Files

- `apps/api/src/index.ts:~86, ~162, ~188`
- `apps/api/src/messaging-worker.ts:~122`
- `apps/api/src/entity-resolve.ts:~87`
- `.claude/rules/database.md` — where criterion 4's answer belongs
