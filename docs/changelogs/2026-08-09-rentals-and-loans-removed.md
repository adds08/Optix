# Rentals and loans are gone, and only the desk moves tools

Two models came out of the product on the same day, on Urban's instruction.
Neither was broken; both described a way of working Urban does not have.

## What changed

### Rented equipment is removed entirely

`vendor`, `rental_order` and `rental_line` are dropped in
`0012_brainy_unicorn.sql`, along with the rental router, the United Rentals
import spec, the `rental.read` / `rental.manage` permissions, the
`rental_overdue` / `rental_due_soon` alerts, `detectRentalsDue`, and the
`isRentalOverdue` / `isRentalDueSoon` / `daysUntilOffRent` rules with their
test suite. `RATE_UNITS` went with them — it existed only to describe a hire
rate.

STInventory tracks small tools Urban **owns**. Hired equipment has a return
date and costs money by existing, which is a different problem with a different
owner, and modelling it here was answering a question nobody had asked yet.

### Loans, borrows and overdue are removed

`assignment.type` and `assignment.expected_end_date` are dropped. Every custody
link is now simply custody: nothing falls due, so nothing goes overdue. Gone
with them: `isOverdueLoan`, `byMostOverdue`, `dashboard.overdueLoans`,
`detectOverdueLoans`, the overdue leg of the notification badge, the REST
`/api/dashboard/overdue-loans` endpoint, and every overdue banner, pill and
card across the web and field apps.

### Only the equipment desk moves tools

This is the change underneath the other two. `custodyOutcome` had three
outcomes and two inputs; it now has two outcomes and one:

- **`verify` is gone.** It existed for a foreman handing a tool to another
  foreman — the tool moved immediately, ownership did not, and the desk
  confirmed it afterwards. With `transfer.verify`, `pending_verification`, the
  borrow-return path in `transfer.decline`, and `homeCustodianId` (which existed
  only to find the permanent owner behind a borrow).
- **`actorCanApprove` is gone.** With foreman-initiated movement removed, no
  actor can reach the rule without already holding the approve permission, so
  the question had one answer.
- **Value is the only gate left.** A tool at or above the tenant's high-value
  threshold still waits for a second administrator.

**Foremen lost `assignment.create` and `transfer.create`.** A foreman sees what
he is holding and what is coming; the desk issues and reassigns. That is the
whole of the change in one line.

## Found while doing it

**The inbox badge counted things the inbox cannot show.** The bell sums six
sources — unread alerts, overdue loans, pending approvals, tasks, messages and
clearance — while the Inbox page renders `inbox.classified`, which is tasks and
messages only, and for a desk user renders nothing else at all. So a badge of 1
against an empty inbox was correct arithmetic and a useless screen. Removing
overdue takes one source out of the six; **the other three are still
unaccounted for**, and pending approvals in particular still has no screen
anywhere. That is gap C1 in the delivery assessment and it is now the last
thing standing between the desk and a working queue.

**`custodyOutcome` had four call sites and the tests knew it.** `assignment.create`,
`transfer.create`, the chat executor and the manual action path all read the
same rule, which is why collapsing three outcomes to two was a small edit in
each rather than four different rewrites. The rule being pure and shared is what
made this safe.

**The high-value gate never applied to foremen.** The old rule returned `verify`
before it ever looked at the value, so a foreman moving a $33,000 total station
and a $90 drill were treated identically. Now that only the desk moves tools,
the value gate applies to every move there is — which is stricter than before,
not looser.

## Deliberately not done

- **No desk queue screen.** `transfer.approve`, `transfer.decline`,
  `assignment.approve`, `assignment.decline` and `assignment.return` still have
  no caller in either app. This change makes the queue smaller and simpler, and
  does not give it a home.
- **Custody writes are still not transactional**, and the one-active-assignment
  invariant still has no database constraint.
- **`docs/15-vendors-and-orders.md` is kept**, marked Removed rather than
  deleted. The reasoning about vendors and purchase orders outlives the code,
  and Urban has since raised orders, quotations and receipts as a possible
  future need — that spec is where to start reading, not from scratch.
- **The `rental` reports are not replaced.** There is nothing left to report on.

## Where it is

`chore/assessment-cleanup-and-desk-alerts`. `pnpm typecheck` 12/12, `pnpm test`
6/6, lint exits 0. Migration `0012` applied to the local stack and the seed
re-run against it clean — 39 foremen, 16 projects, 29 trailers, 754 tools.
Verified in the running containers that the `foreman` role now holds zero
custody-write permissions while `equipment_admin` and `warehouse` hold two each.
Not deployed.
