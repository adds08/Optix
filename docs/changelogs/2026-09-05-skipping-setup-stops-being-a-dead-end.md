# Skipping setup stops being a dead end

Asked for by the user: if you skip onboarding, say so in the sidebar and give
you a way back into it. Doing that surfaced a second, worse bug in the gate
itself.

## Skipping was unrecoverable

`complete({ dismissed: true })` stamped the same `completedAt` a real finish
does. The two differed only in an audit-log action string that no screen reads,
the gate stopped firing, and there was no route to `/welcome` from anywhere in
the product. Skipping abandoned the work permanently.

The schema comment on that column argued the distinction did not matter, because
"the product question is should this person be sent here again" — and for the
REDIRECT that is true. It was wrong in a way worth remembering: it answered the
question in front of it and discarded information a second question needed a day
later. `dismissedAt` now records which of the two happened, `state` derives
`needsSetup` from it, and a new `resume` clears both timestamps so the wizard
reopens at the step the person stopped on.

`SetupNotice` in the sidebar footer is the way back. Deliberately a NUDGE, not a
gate: the first-run redirect still fires once and never again, because a gate
that reappears every session stands between a foreman and the tool they came to
check out. This sits quietly instead, on every screen, and is dismissed by doing
the work. It renders nothing for somebody who finished, nothing for an account
with no employee record (never sent to the wizard, so nagging it would be
nagging about a task the product will not allow), and nothing in the collapsed
48px rail, which has no room for a sentence.

Finishing after a skip nulls `dismissedAt`, so "skipped" is a current state
rather than a permanent mark. Migration `0048`.

## The gate never fired for field roles, and a hard reload hid it

Found while testing the above. A superintendent signing in landed on
`/my-tools`, never on the wizard — every single time, not intermittently.

`/home` redirects field roles to `/my-tools` the moment `identity.me` resolves.
The wizard gate in `app-shell.tsx` waits for `onboarding.state`, which resolves
later. The field redirect won, and because it is a client-side navigation the
shell never remounts, so the gate's dependencies never changed again and the
wizard simply never opened.

What made this expensive to find is that **a hard reload worked perfectly** —
the query is warm, the gate wins, `/welcome` opens. Every manual check of "does
the gate work" had been a reload. Two wrong diagnoses came before the right one:
first the pinned-row landing redirect (guarded, and the guard held — the marker
was still unspent while the browser sat on the wrong page, which is what proved
it innocent), then `isPending` on the onboarding query, which is `false` for a
DISABLED query and so waved the redirect straight through the window it was
meant to close. Both guards were kept: they are correct, and the pin redirect
had the same latent race.

The fix is in `/home`: wait for `onboarding.state` DATA, and yield if it says
this person should be prompted.

## Verified

`pnpm typecheck`, `pnpm lint`, `pnpm test` in the api container — 351
`api-contracts` tests, five new ones covering the skip/resume/finish cycle
including that resume is a no-op for somebody who genuinely finished and that
the notice is never offered to an account with no employee record.

Driven in a browser: a superintendent signing in now lands on `/welcome`,
skipping takes them to `/my-tools`, the notice appears in the sidebar and
persists across screens, and clicking it reopens the wizard at "Let's get you
set up, Marcus". No console errors.

Local only. Not deployed.
