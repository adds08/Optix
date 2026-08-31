# Three off the known-issues list

`docs/KNOWN-ISSUES.md` carried six open defects, verified against the code and deliberately
kept free of anything already fixed. Three of them were one-line-shaped and are now gone from
the file, which is what that document asks for: fixed items are deleted, never marked
resolved, because a list carrying closed items stops being read.

The three that remain are not this kind of problem — a trusted-proxy allow-list and worker
concurrency are real design work, and the SMS channel is a decision about whether to build
it.

## What changed

### `asset.setStatus` takes the status enum

It declared `status: z.string()`. Status columns are plain `text` by design — the
vocabularies live in `packages/types` and Zod at the router edge is the only thing enforcing
them — so this procedure was the hole in that arrangement. An unknown value went into the
projection *and* into the ledger `to_state`, and because the ledger is append-only it folds
back out forever. There was nothing between the client and the system of record.

The narrower type immediately caught a caller. `tool-menu.tsx` built its status list as an
untyped array, so it widened to `string[]` and typechecked against `z.string()` happily. That
array is now `as const`, which is the other half of the fix: the client can no longer form
the bad call, rather than being refused at runtime for making it.

### `asset.create` refuses a tag already in the register

`asset.update` has raised `CONFLICT` on this since it was written, and `import.commit` checks
both the database and the file for duplicates within it. The single-asset create path checked
nothing — so the only door left open was the one the desk uses most.

Worth being precise about what this protects. `asset.tag` is a **label**, not an identifier;
`asset.id` is identity. A duplicate tag is a data-quality problem for the people who call a
tool by its tag out loud, never a referential one. That is also why this is a check and not a
unique index: the register legitimately carries untagged rows, and rows imported before
anybody cared may already collide.

### The login lookup folds case, and so does the duplicate check that guards it

`login()` compared the address verbatim, so `Alice@x.com` did not find a stored
`alice@x.com`. What made that confusing rather than merely strict is that the rate-limit key
in `apps/api` **does** lowercase the address: the two halves of one request disagreed about
what the user's email was, so somebody typing the wrong case was throttled under a key that
matched while being told their credentials were wrong.

The comparison lowers the **column**, not just the input. Normalising the input alone would
fix nothing for a row already stored with capitals, which is exactly the case that locks
somebody out.

## What was found while building it

**The case-sensitivity was one decision living in two files, and fixing half of it would have
been worse than fixing none.** `user.create` carried a comment saying the address is
*"Trimmed, NOT lower-cased. `login()` compares the address verbatim, so folding case here
would store an address the person cannot type back."* That reasoning was sound while login
was verbatim. Change login alone and the duplicate checks still compare verbatim — so
`alice@x.com` could be created beside an existing `Alice@x.com`, login would then match two
rows, hit STI-305's ambiguity guard, and refuse **both** accounts with no screen able to
explain why.

Both checks in `user.create` now fold case. The address is still **stored** as typed, because
it is shown back to people and printed on invitations; what changed is that nothing compares
it verbatim any more.

**The ambiguity guard is what makes the widening safe.** `login()` reads two rows and refuses
unless exactly one matches, so a case-collision pair fails closed rather than authenticating
the wrong account. That behaviour was already there for cross-tenant collisions; it covers
this case for free.

## Verified

Both databases were checked for pairs that differ only by case *before* shipping the auth
change, because making the lookup case-insensitive would lock out both halves of such a pair:

```sql
SELECT tenant_id, lower(email), count(*) FROM tbl_entity_user
GROUP BY 1,2 HAVING count(*) > 1;
```

Empty locally and zero rows on production, so nobody is affected.

Nine tests added. Login is asserted from both directions — upper-cased, alternating-case and
space-padded addresses all find the account — and the guards are asserted to still refuse: a
wrong password still fails whatever the case, the tenant hint still scopes, and an ambiguous
address typed in another case is still refused rather than resolved. `user.create` refuses a
case-variant duplicate. `asset.create` refuses a duplicate tag while still allowing any
number of untagged tools, which is the trap in that check — `tag` is nullable on purpose and
a naive equality would refuse the second untagged tool in the register. `setStatus` refuses a
value outside the vocabulary and leaves the projection untouched, and still accepts one
inside it.

`pnpm typecheck` clean. `turbo run test` green in every package, run inside the api container
so the database-backed suites executed rather than skipping — api-contracts went from 262 to
271.

**Not verified:** none of this was exercised through a browser. All three fixes are at the
router and auth layer, which is where the tests are, but the `tool-menu.tsx` change is a UI
file and only typecheck says it still renders.

## Deliberately not done

**The three remaining issues.** The rate-limit header trust needs a trusted-proxy allow-list
and a socket-address fallback; the workers need `FOR UPDATE SKIP LOCKED` and in-flight guards
before a second instance ever runs. Both are design work, not one-line changes, and doing
them badly inside a batch of small fixes is how a real bug gets shipped. The SMS channel is a
build-or-drop decision that belongs to whoever owns the roadmap.

**No unique index on `asset.tag`.** The register carries untagged rows and historical
collisions; a constraint would refuse writes that are legitimately already there.

**Email is not normalised on write.** Storing what the person typed is deliberate — it is
what appears on invitations — and the comparison is now the thing that is case-blind.

## Where it is

Branch `fix/known-issues-3-4-5`, off `main`. Independent of the two branches open alongside
it; it touches the asset router, the auth package, the user router and one web component,
none of which they change.

**Not deployed.**
