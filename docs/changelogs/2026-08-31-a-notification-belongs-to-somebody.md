# A notification belongs to somebody, and the bell stops counting a deleted feature

Reported from production in two sentences: *"what even is this?"* and *"when I click on
these items nothing happens."* The bell was listing repair decisions the signed-in owner
had never asked for and could not clear. Both halves came out of one nullable column.

`user.employee_id` is nullable — seven of the fifteen seeded accounts have no employee
row, `owner@` among them — and `dashboard.notifications` narrowed the alerts query like
this:

```ts
empId ? eq(schema.notification.recipientEmployeeId, empId) : undefined
```

Drizzle's `and()` **drops** an `undefined` member rather than reading it as "match
nothing". So for an account with no employee record the recipient predicate vanished and
the query returned every unread notification in the tenant. `notification.markRead` scopes
to the recipient and correctly refused to touch rows that were not the caller's, returning
`{ ok: true }` after writing nothing — the client invalidated, refetched, and the same
rows came back. Hence "nothing happens": the read was too wide and the write was right.

## What changed

### An account with no employee record is the recipient of nothing

Both readers now say so. `dashboard.notifications` builds the recipient predicate once and
short-circuits the round-trip entirely when there is no employee id;
`notification.list` returns `[]` before querying. `notification.list`'s old fallback was
the same bug written out longhand — it re-stated `eq(tenantId, tid)`, which reads like a
scope and is the absence of one.

The tenant-wide view is a real thing and it already exists: `notification.all`, one
procedure down, behind `notification.manage`. Nothing here needed to be that.

### The badge counts what is waiting for you, and only that

Two errors in one expression, `alerts.length + approvals + tasks + messages + clearance`:

- `clearance` is the HR offboarding gate, **removed on 2026-08-27**. The popover already
  declines to list it as a queue for exactly that reason, with a comment saying so — but
  the badge summed it anyway. On the seeded database that was 23 of 30. It is still
  returned in `queues`, because the number itself is real (tools held by terminated
  employees); it is no longer counted as work.
- `alerts.length` is the popover's page, capped at five. The badge under-reported anyone
  holding more than five unread alerts, which is the moment the number matters most. It is
  a real `count()` now.

### The comment that said the two numbers could not disagree

It claimed the badge was "the same sum the inbox shows … so the bell and the inbox cannot
disagree about the number". They were never equal — the popover's footer counts the queues
and not your alerts — and asserting the invariant is how the `clearance` term survived
being read several times. The comment now says what each number means and why they differ.

### STI-123, opened

Found while tracing where these notifications come from, and unrelated to the fix: the
repair loop has no end. See below.

## What was found while building it

**The approval side is sound, which was worth establishing before touching anything.** A
"Repair requested" task carries `action_type: 'repair'`, `repair` maps to `asset.manage`
in the intent catalog, and `approveTaskAction` charges that permission against the
**approver**, not the requester. So who decided is defined, enforced and in the event log.
The `awd` in the production screenshot is a real decline reason somebody typed.

**`repair_complete` is a declared event type with no writer.** `packages/types` declares
it and the tool timeline gives it a colour; nothing in the tree emits it. Approving a
repair emits `repair_start` and the only way out of `in_maintenance` is somebody editing
the status off a menu. Fold the ledger for a repaired tool and it still says "sent for
repair" — the projection and the ledger disagree about the world while each stays
internally consistent, the same shape as the STI-207 container bug and the same reason it
raises no divergence. Written up as **STI-123**, which carries a decision (who signs a
repair off) that needs Urban rather than a schema opinion.

**`task.decline` skips its permission check for note-shaped tasks.** The guard is
`if (task.actionType && !canApplyAction(...))`, so a task with no `actionType` — which
`approveTaskAction` explicitly refuses as "a note, not a request" — can be declined by any
signed-in account with no permission at all. Approvable by nobody, killable by everybody,
and decline is the side that is wired to the UI. **Not fixed here** and not yet ticketed;
it wants its own change, because the right answer may be that a note should not go through
the decision path at all.

**`task.approve` has no UI caller, but approving is reachable.** The reachability TODO
names the procedure, not the capability: `inbox.resolve` calls the same
`approveTaskAction`. Worth knowing before anyone "fixes" the asymmetry by wiring a second
path to the same function.

## Verified

- New `packages/api-contracts/src/notification-recipient.test.ts`, four cases, run against
  real Postgres **in the api container** — the host run skips every database suite
  silently (192 skipped there, which is why the container is the only honest number.)
- **Confirmed the tests fail without the fix**: stashed both routers, re-ran, 3 of 4
  failed (the fourth is the guard case, an account that has an employee record, which
  passes either way and is there to prove the fix did not overshoot). Restored, 4 passed.
- Full db-backed suite in the container: **26 files, 261 tests, all passing.**
- `pnpm typecheck` and `pnpm lint` clean from the repo root.
- Against the live API after restarting the container: `owner@` (no employee record) now
  gets `alerts: 0`, `notification.list` returns 0 rows, and `unread` is 5 rather than 30 —
  with `clearance: 23` still reported in `queues`. `foreman@` (has one) sees exactly their
  own alert and nothing of anyone else's.

Not verified: nothing was run against production, and the production owner account was not
inspected. `SELECT email, employee_id IS NULL FROM tbl_entity_user;` there will confirm
which accounts were affected.

## Deliberately not done

- **Notification rows still do not navigate.** They carry `refType: "task"` and `refId`,
  and `dashboard.notifications` still does not select them. Making them link was proposed
  and dropped on the user's push-back, which was correct: there is no task detail route
  (`task.get` is also unwired), so the destination would be a request decided with no
  record of whether the work happened. Deep-linking into a flow that does not close is
  polish on the wrong thing. STI-123 first.
- **The note-shaped decline hole**, above — found, written down, not fixed in a change
  about notification recipients.
- **The popover's footer arithmetic** was left as the queue total. It is a different
  number from the badge on purpose and the comment now says so, rather than the number
  being changed to match a claim.

## Where it is

One commit on `development`, subject "Give every notification a recipient, and stop the bell counting a deleted gate". **Not pushed and not deployed** — which matters more
than usual here: the leak is live in production and this fix is not, so the owner account
is still being served other people's alerts until this ships.

Note `56dc9bd` landed between sessions from another hand, with `#` as its subject: it is
yesterday's browser-suite removal, unrelated to this.
