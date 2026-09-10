# The onboarding gate stops fighting the password gate, live in a browser as the person it broke

Reported directly: "the login page for engineer priya, its flickering between home,
welcome, login, onboarding!" Reproduced live — signed in as her account
(`engineer@stinventory.local`, `mustChangePassword: true`, onboarding never
finished) — and watched `/account/password` and `/welcome` swap every render, with
no form submitted and nothing clicked. This was not a one-time hop; it was a
standing loop.

## What was actually happening

`onboarding.state` is one query, one cache entry, shared by every component that
calls it. `app-shell.tsx` deliberately gates its own read —
`enabled: !!me.data && !me.data.mustChangePassword` — specifically so the password
gate always wins first and the onboarding gate cannot fire until it clears. That
gate works exactly as designed, in isolation.

It does not work in company. Two other components call the same query with no
`enabled` condition at all:

- `components/onboarding/setup-notice.tsx` — the sidebar's "Finish your setup"
  nudge, mounted inside `AppShell` on every `(app)` page, `/account/password`
  included.
- `app/(app)/home/page.tsx` — and here the gate was already **documented as
  existing** ("this query is disabled until `me` resolves") in a comment that
  described intent nobody had wired up. The code below it was
  `trpc.onboarding.state.useQuery()`, no options, fetching unconditionally on
  every mount — which happens on `/home` for a fraction of a second on every
  single sign-in, in the exact window before the password redirect has fired.

`enabled: false` only stops the gated instance from asking the server. It does
nothing to stop that instance from reading data a DIFFERENT, ungated instance
already put in the cache. So the sidebar (or `/home`, in the instant before the
password redirect lands) fetched `onboarding.state`, got back `shouldPrompt: true`
for an unfinished account, and `app-shell.tsx`'s own gated `useQuery` — which
never made a request of its own — read that borrowed answer and fired its redirect
to `/welcome` anyway. `/welcome`'s own effect then saw `mustChangePassword: true`
and sent her straight back. Nothing about the loop needed a page reload, a second
tab, or a form submission — it reproduced on a bare sign-in.

## What changed

`setup-notice.tsx` and `home/page.tsx` now carry the identical gate
`app-shell.tsx` already had:

```ts
const me = trpc.identity.me.useQuery();
const onboarding = trpc.onboarding.state.useQuery(undefined, {
  enabled: !!me.data && !me.data.mustChangePassword,
});
```

Each carries a comment naming the other two by file, the same way `BUILT_IN_PERM`
and `canAssignIntoTier` in `projectTeam.ts` are kept in lockstep by hand elsewhere
in this codebase — there is no single source of truth for this condition, so the
next caller of `onboarding.state` has to copy it deliberately rather than discover
the race by shipping it.

A second, smaller bug in the same neighbourhood: `account/password/page.tsx`
redirected via `setTimeout(() => router.replace("/"), 1200)` after a successful
change, unconditionally — regardless of whether the shell had already navigated
the user elsewhere in that 1.2 second window. Fixed two ways: the timer is now
held in a ref and cleared on unmount, and its destination is `/home` rather than
`/`, which removes a pointless hop through the login page's own "already
signed in, forward to /home" check for the ordinary case where nothing else has
navigated first.

## Verified

Live, in a real browser, as the actual reported account — not inferred from
source:

1. Before the fix: signed in as `engineer@stinventory.local` with
   `mustChangePassword: true` and an unfinished onboarding row. Landed on
   `/account/password`, and a snapshot taken seconds later showed `/welcome`
   instead, with no action taken in between. The Next.js dev overlay's own
   "Rendering…" indicator was live the whole time.
2. After the fix: same account, same starting state. `/account/password` held
   for 4+ seconds with no navigation. Submitted a real password change — landed
   on `/welcome` (correct: the account genuinely hasn't finished onboarding,
   `mustChangePassword` is now false, so this is the intended next screen, not a
   bounce). Completed the wizard's "Review and finish" step (the only step in
   her `steps` array, since she is currently on no job — a separate, pre-existing
   data state from an earlier deliberate roster clear, not touched here).
   Landed on `/home`, held 4+ seconds, then navigated to `/people` and held
   there too.
3. Database after: `must_change_password: false`,
   `tbl_ops_user_onboarding.completed_at` stamped, `dismissed_at` still null — a
   real finish, not a skip.
4. `pnpm typecheck` — 13/13 packages clean. `pnpm lint` — 0 errors (unchanged
   warning count). `pnpm test` — 362/364, the same two pre-existing
   `rbac-matrix.test.ts` failures as every prior run this session (the demo
   roster is currently cleared locally; unrelated to this change and not
   reproducible in CI, which seeds fresh).

## Deliberately not done

- Did not reseat Priya (or anyone) onto a project. Her account having no roster
  row is a separate, already-documented, deliberate state from an earlier
  session's roster clear — restoring it is a data decision, not a bug fix, and
  is out of scope here. The wizard now handles that state correctly (lands on
  "Review and finish" instead of crashing or looping), which is the actual bug
  that was reported.
- Did not introduce a shared hook for the `enabled` condition, even though it is
  now duplicated three times. This codebase's own convention for a small,
  security- or sequencing-critical condition that has to be kept in step by hand
  (`BUILT_IN_PERM`) is a comment on each copy naming its siblings, not a new
  abstraction — followed the same pattern rather than inventing a fourth thing.
- Did not chase a "3 errors" count the browser's console reported on `/people`
  during verification — the page rendered completely and correctly, and the
  errors were not visible to the person using it. Worth a look, not part of
  this fix.

## Where it is

Uncommitted in the working tree, on `development`.
