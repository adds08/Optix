# STI-116 — The `/api/*` REST surface writes assets and custody outside every control

**Phase:** 1 — Custody trail
**Size:** 1 unit
**Status:** ✅ DONE — resolved by deletion, 2026-08-18
**Found by:** the STI-110 implementer on 2026-08-18 (as a no-evidence factory).
Widened by the lead on reading it — the defect is larger than first reported.

---

## Why this exists

`apps/api/src/rest-routes.ts:175-178`, in full:

```ts
rest.post("/api/assets", async (c) => {
  const body = await c.req.json();
  const [row] = await db.insert(s.asset).values({ ...body, tenantId: tid(c), currentStatus: body.currentStatus ?? "available" }).returning();
  return c.json(row);
});
```

Three separate problems, in ascending order of seriousness:

1. **No ledger event.** An asset created here has a projection and zero history. It is a
   literal no-evidence factory — the state STI-110 exists to report and cannot repair,
   because the ledger is append-only by trigger and the opening snapshot can never be
   added retroactively.

2. **No validation.** `{ ...body }` spreads the raw JSON body into the insert. There is no
   Zod schema at this edge, unlike the tRPC surface.

3. **Mass assignment onto the custody projection.** The spread means a caller can set
   `currentCustodianId`, `currentProjectId`, `currentLocationId` and `currentStatus`
   directly. That is writing custody state with **no ledger event and no custody
   chokepoint** — `CLAUDE.md`'s "don't update a projection directly" and "don't add a
   second way to write custody" violated in one statement. And per `CLAUDE.md`'s own trap
   table, **the `/api/*` REST surface has no permission checks at all**, so nothing gates
   it.

## Defect 4 — REST approve writes custody outside the chokepoint

Found by STI-103's QA on 2026-08-18 by driving the running app, and confirmed by the lead.
`apps/api/src/rest-routes.ts:127-131`:

```ts
rest.post("/api/assignment/:id/approve", async (c) => {
  await db.update(s.assignment).set({ status: "active" })
    .where(and(eq(s.assignment.id, c.req.param("id")!), eq(s.assignment.tenantId, tid(c))));
  return c.json({ ok: true });
});
```

It flips an assignment to `active` with **no call to `custody.ts`**, so it never closes the
previously active link, never writes a ledger event, and never updates the projection. This is
literally the "second way to write custody" that `CLAUDE.md` names as the most expensive
pattern this codebase has paid for. `POST /api/transfer/:id/approve` immediately below it
should be checked for the same shape.

**Since STI-103 this fails loudly rather than corrupting.** QA drove it against an asset that
already had an active link: HTTP 500, the full `duplicate key value violates unique constraint
"assignment_one_active_uq"` in the API log, and — importantly — **the database state stayed
correct**. That is the index doing its job. It is not a reason to leave the route alone: on an
asset with *no* active link it would still succeed and produce custody with no ledger event.

## RESOLVED — the whole surface was deleted, 2026-08-18

The caller check the ticket demanded was run and came back empty:

- No reference to any `/api/*` path in `apps/web` or `apps/mobile`.
- The only mention outside docs was the mount itself in `apps/api/src/index.ts`.
- **The production `docker/Caddyfile` routes only `/trpc/*`, `/auth/*`, `/health`,
  `/assets/*`, `/media/*` and `/field/*`.** `/api/*` never reached this process in
  production at all.

So `apps/api/src/rest-routes.ts` (349 lines, 28 routes) was deleted outright, along with
its import and `mountRestRoutes(app, db)`. A comment at the mount site records why, next to
the existing note about `POST /ai/chat` being removed for the same reason: a second
executor is the bug.

**One trap that nearly made this dangerous.** The surface installed a blanket
`rest.use("*")` bearer middleware and was mounted with `app.route("/", rest)` *before* the
tRPC handler, so it also intercepted `/trpc/*`. Deleting it therefore changes tRPC's
unauthenticated behaviour. Verified this is an improvement, not a regression: tRPC resolves
its own session in `createContext` and always did, so an unauthenticated call now returns a
proper tRPC `UNAUTHORIZED` envelope instead of a bare `{"error":"Unauthorized"}`, and every
authenticated call no longer resolves its session twice.

Verified after deletion: `/health` 200, login works, authenticated tRPC works with 0
divergences, `POST /api/assets` returns 404, web renders, 144 tests green, typecheck 12/12.

## Original scope note — kept for the record



Establish whether this route has any caller before writing code. The STI-110 implementer
described the REST surface as "unrouted in prod and slated for deletion". **Confirm that
rather than inherit it.**

- **If nothing calls it:** delete the route. That is the whole ticket, and it is the right
  answer — hardening a dead endpoint is work that buys nothing and leaves a second way to
  write assets alive for the next person to find.
- **If something calls it:** it needs a Zod schema, an explicit field allow-list that
  excludes every `current_*` column, an opening `tag` event with a complete four-key
  `toState` written in the **same transaction** (see STI-115), and a decision recorded
  about the missing permission check.

Do not guess which case applies. Grep the web app, the mobile app, and any script or
document that names `/api/assets`, and say what you found.

## Acceptance criteria

1. A recorded finding on whether the route has any caller, with the evidence behind it.
2. Either the route is removed, or it validates its input, cannot write any `current_*`
   column from the body, and writes an opening ledger event transactionally.
3. If it is removed, grep for and sweep any doc or client naming it.
4. If it is kept, a test proving a request body carrying `currentCustodianId` cannot set
   custody.
5. `POST /api/assignment/:id/approve` and `POST /api/transfer/:id/approve` either go away
   with the rest of the surface, or route through `custody.ts` like every other writer.
   Leaving a custody write outside the chokepoint is not an option — it is the one pattern
   `CLAUDE.md` singles out.
6. The wider question is **named, not silently fixed**: the `/api/*` surface has no
   permission checks. This ticket does not fix that — it records it. Say whether other
   REST routes have the same mass-assignment or bypass shape, and file what you find rather
   than fixing it here.

## Related

- **STI-115** — the tRPC `asset.create` has the atomicity half of this defect.
- **STI-103** — the index that converted defect 4 from silent corruption into a loud 500.
- **STI-110** — the sweep that reports the resulting assets.

## Files

- `apps/api/src/rest-routes.ts:175-178` — the route
- `CLAUDE.md` — "A permission check does nothing → you are on the `/api/*` REST surface"
