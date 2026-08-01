# What the dashboard should answer

The desk dashboard shows stock levels: how many tools are available, assigned,
in maintenance, lost, reserved, what the fleet is worth. Those are true and they
are static. A person opening the screen in the morning is asking a different
question — what changed, what is stuck, and what needs me — and the current
answer is three attention cards covering overdue loans, HR clearance and pending
approvals.

Four things are missing, and each of them exists because of a change made
elsewhere in this sequence.

## Borrows waiting on the desk

`docs` history: a foreman's hand-off now applies immediately as a temporary
borrow and lands in the desk's queue as `pending_verification`, rather than
either auto-approving itself or blocking. That queue is the single most
time-sensitive thing on the desk's plate, and right now it is invisible — it is
mixed into the existing "Awaiting approval" card alongside genuine held
requests, which are a different question with a different answer.

"Awaiting approval" means *may this happen*. "Awaiting verification" means *this
already happened, is the record right*. Putting them in one pile means the desk
reads every row twice to work out which kind it is.

`dashboard.pendingApprovals` already returns both — the prior change added
`pending_verification` to its `inArray` filter and selected `status`. So no new
query is needed:

```
const all      = approvals.data ?? [];
const holds    = all.filter(a => a.status === "pending_approval");
const borrows  = all.filter(a => a.status === "pending_verification");
```

Two cards instead of one. The existing "Awaiting approval" card takes `holds`;
a new card takes `borrows`:

```
<AttentionCard
  tone="warn"
  icon={Handshake}
  title="Loans to verify"
  count={borrows.length}
  href="/inbox"
  empty="No foreman hand-off is waiting to be checked."
>
  rows: <Tag>{p.assetTag}</Tag>  ·  {p.fromName} → {p.custodianName}  ·  {relative(p.createdAt)}
</AttentionCard>
```

`fromName` is already selected by that query — it was added so the desk could
see both ends of a hand-off rather than only the recipient.

This is a client-side split of an existing result. Do not add a backend query
for it unless a nav badge later needs the count server-side.

## Spend by department against project

`docs/11-department-cost-targets.md` adds a second kind of cost target. The
moment a mechanic's tools are charged to Repair & Maintenance, the existing
"Fleet value" number stops telling the whole story — it is one total with no
split, and the question the owner will ask is how much of the fleet is carried
by jobs versus by the shop.

Two `Metric` tiles reading the two report queries:

```
capitalByProject     -> sum(capitalValue)  -> "Capital on jobs"
capitalByDepartment  -> sum(capitalValue)  -> "Capital in the shop"
```

Both already exist as report procedures after phase 1; the dashboard just sums
and displays them. Keep "Fleet value" as it is — it is the total, and the two new
tiles decompose it.

## Idle tools

`report.idle` already exists and returns every tool sitting `available`. It is
reachable only by navigating to the Idle report, which means nobody looks at it
until they already suspect something.

Surface the count as a `Metric` linking to that report. A yard with forty idle
tools has either over-bought or lost track, and either is worth seeing daily.

## Missing serials

This one is new, and it is the data-quality number that matters most given where
the data comes from.

The trailer sheets in `docs/13-excel-round-trip.md` have a SERIAL # column that
is sometimes blank — look at the real sheet and the Skill Saw and both Quikie
Saws have no serial. A serialized tool with no serial number cannot be
identified after it is stolen, cannot be matched against a police report, and
cannot be deduped on import. It is the single gap that most reduces what the
register is worth.

New count, either folded into `dashboard.kpis` or as its own small procedure:

```ts
const missingSerial = await ctx.db
  .select({ c: count() })
  .from(schema.asset)
  .where(and(
    eq(schema.asset.tenantId, tid),
    eq(schema.asset.isSerialized, true),
    isNull(schema.asset.serialNumber),
  ))
  .then((r) => Number(r[0]?.c ?? 0));
```

`isSerialized` matters — bulk lines legitimately have no serial and must not be
counted as a gap.

Render it as a `Metric` with `tone={missingSerial ? "warn" : "ok"}` and a hint
like "cannot be identified if stolen", so the number reads as a consequence
rather than a statistic.

## Where the code goes

Everything here is additive. `packages/api-contracts/src/routers/dashboard.ts`
gains one count in `kpis`; `apps/web/app/(app)/home/page.tsx` gains one
`AttentionCard` and three `Metric` tiles, using primitives already defined in
that file (`AttentionCard`, `Row`) and in `@/components/sti/page` (`Metric`).

No schema changes, no interaction with custody, no new permissions.

## Order of work

1. `dashboard.ts` — add `missingSerial` to the `kpis` return
2. `home/page.tsx` — split `approvals.data` by status, add the "Loans to verify"
   card, adjust the existing card to take only `pending_approval`
3. `home/page.tsx` — add the three `Metric` tiles: capital on jobs, capital in
   the shop, idle, missing serials
4. Leave the `attention` count summing the **full** `approvals.data`, not the
   filtered `holds`

Step 4 is the trap. `attention` decides whether to replace all three cards with
the "Nothing is waiting / The yard is square" empty state, and it currently sums
`overdue + clearance + approvals`. Because `pendingApprovals` already returns
borrows alongside held requests, that total is correct as it stands. Rewiring it
to the filtered `holds` while adding the new card would print "The yard is
square" above an unread verification queue.

## Verification

- Raise a hand-off as a foreman. Confirm it appears under "Loans to verify" and
  not under "Awaiting approval".
- Verify it from the Inbox. Confirm the card count drops.
- With nothing outstanding, confirm the "Nothing is waiting" empty state appears
  — and that it does *not* appear while a borrow is unverified.
- Register a tool with cost target Department and confirm "Capital in the shop"
  moves while "Capital on jobs" does not.
- Register a serialized tool with no serial and confirm the missing-serial count
  rises; register a bulk line with no serial and confirm it does not.
