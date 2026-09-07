# The pin that was never yours to drop

2026-09-06

Reported as two things — "in map and later you don't own location issue" and
"map looks weird" — and they turned out to be one bug and one layout failure
sharing a screen.

## The bug

Step three listed every job on the wizard's step-one list and let you click the
map on any of them. `setLocation` requires a live roster row; a step-one tick
writes a `project_claim`, which is a statement about yourself and grants
nothing. So clicking the map on a job you had claimed but were not rostered on
produced a red **"You are not on this job."** straight from the server.

Reproduced before fixing: tick any job under "Everything else", advance to step
three, click the map — 403, every time.

The person had done nothing wrong. The UI offered an action that could never
have worked, and then blamed them for taking it. `onRoster` was already on the
payload and the client simply ignored it.

**Fixed in the client, deliberately not in the server.** Loosening
`setLocation` to accept a claim would make a claim into authority, which is the
one thing it must never be — that is why `setClaim` needs no permission at all.
So `onRoster` now drives the step: the map stops binding click and drag, the
pin control disappears, the picker marks those jobs "not yours to set", and one
amber line explains that whoever runs the job can drop the pin. The step also
opens on a job you can actually edit rather than whichever came first, since
landing on the one read-only state would read as the step being broken.

The stale comment above `myClaimedProjects` claimed it was "scoped to jobs the
person actually holds a live roster row on" while the body underneath unioned
in claims — it now says what the query does and what the client owes it.

Two tests pin the contract: `setLocation` and `fillDetails` both reject a
claim-only job. They assert the refusal rather than leaving it implied, because
the new UI is only correct while the server still refuses.

## The map

It was a fixed 360px box inside a 672px column inside a half-screen panel — a
control that is strictly more useful the bigger it is, given the least room on
the screen, with the picker and the location button consuming a row above it.

The map is now the step: full width of a widened column, its own bordered
surface with no card wrapped around it, and the job picker, location button and
address riding on the tiles as overlays. `max-width` is no longer one number
for all five steps — a list wants width to keep a code, name and address on one
line, a map wants everything going, and a two-field form has to stay near a
reading measure however much room is spare.

**Leaflet was also ignoring the job you picked.** `MapContainer`'s `center` and
`zoom` are initial values only, read once at mount, so switching jobs left the
view on the previous job's coordinates — a pinned job looked unpinned and an
unpinned one looked wrongly placed. `RecenterOn` calls `setView` imperatively,
un-animated, because this is a jump between two unrelated places rather than a
pan across one.

First attempt put the overlay bar at the left, where it sat on top of Leaflet's
own zoom buttons, and used the picker's transparent trigger, which over map
tiles stopped reading as a control at all — street names ran straight through
the job name. Both visible in the screenshot, both fixed.

## Verified

Both paths driven in a real browser: a rostered job (pin saves, map recenters
and zooms to it) and a claim-only job (no 403, controls hidden, explanation
shown). All five steps swept for console errors and page-level horizontal
overflow — none. `pnpm typecheck` and `pnpm lint` clean; 353 api-contracts
tests pass, two of them new.
