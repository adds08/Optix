# Vendors, purchase orders and where tools come from

Urban buys and rents small tools from vendors — United Rentals most of all. The
register knows what tools exist and who holds them. It does not know where any
of them came from.

There is a `vendor` table. It has been there since the rental work, it is
populated automatically every time somebody imports a United Rentals export, and
it has no screen anywhere in the application. There is no `/vendors` route, no
nav item, and no router beyond a read-only `rental.vendors` list used to
populate a filter.

More consequentially, `asset` has no link to a vendor at all. No
`purchasedFromVendorId`, no `purchaseOrderId`, nothing. "Which vendor did this
drill come from" is unanswerable, and so is "what did we spend with United
Rentals last quarter" for anything owned rather than rented.

This document is a roadmap, not a build order. Nothing here should be
implemented in the same pass as phases 1 through 4 — it wants its own scoping.

## What already exists, and is closer than it looks

`rental_order` is a purchase order in everything but name:

```
rental_order
  vendorId              -> vendor
  externalNumber          the vendor's contract or quote number
  orderType               quote | open_contract | closed_contract
  status                  quoted | on_rent | closed | cancelled
  jobsiteLabel            free text off the vendor's export
  projectId             -> project, linked by hand afterwards
  orderedByLabel          who asked for it, as the vendor recorded it
  orderedByEmployeeId   -> employee, when we can resolve them
  startDate, endDate, notes
```

with `rental_line` beneath it holding `catClass`, `itemName`, `quantity`,
`unitRate`, `rateUnit`, `status`, `returnedOn`.

That is a vendor, a document number, a status lifecycle, a project, a requester
and line items. A purchase order needs exactly those things.

Note also that `RENTAL_ORDER_TYPES` is deliberately United Rentals' own
vocabulary — the enum comment says so. That was the right call for importing
their exports and it is worth preserving as the import continues to depend on it.

## The three pieces

### 1. A Vendors screen

The cheapest real win here, and completely independent of everything else in
this document.

The table exists and has rows in it. Build a list and detail screen:

```
/vendors            list: name, account number, contact, active
/vendors/[id]       detail: contact block, orders from this vendor,
                            tools purchased from them (once linked, below)
```

New `vendorRouter` with `list`, `get`, `create`, `update`, gated by new
`vendor.read` / `vendor.manage` permissions. Move `rental.vendors` to delegate
to it rather than duplicating the query.

One thing to fix while there: the rental import auto-creates vendors by exact
name match, defaulting to `"United Rentals"` when no name is given. Exact string
matching means `"United Rentals"` and `"United Rentals Inc"` become two vendors
that both look right in a list and split every spend total between them. A
Vendors screen makes that visible for the first time, and should offer a merge.

### 2. Link a tool to where it came from

Two nullable columns on `asset`:

```ts
purchasedFromVendorId: uuid("purchased_from_vendor_id")
  .references(() => vendor.id, { onDelete: "set null" }),
purchaseOrderId: uuid("purchase_order_id"),   // FK once the order table below exists
```

Nullable, additive, no backfill obligation — every existing tool simply has an
unknown source, which is honest.

This is the seam that makes vendor spend possible. Without it, `capitalByProject`
and `capitalByDepartment` can say what a project spent, but nothing can say what
a *vendor* was paid, and vendor negotiation is where the money is.

### 3. Generalise the order tables

Recommended over a parallel `purchase_order` table. Forking would mean two
tables both pointing at `vendor`, two import paths, two status vocabularies, and
every "what have we got from this vendor" query becoming a union.

```
rental_order  ->  order        orderType: 'rental' | 'purchase'
rental_line   ->  order_line
```

The honest tradeoff: `order_line`'s `unitRate`, `rateUnit` and `returnedOn` are
meaningless on a purchase line. A bought drill has no rate unit and never comes
back. Two options:

- **More nullable columns**, always null for one order type. Matches the
  existing convention in that file — `rentalLine.unitRate` is already documented
  as "null means unknown, not free" — and keeps one table.
- **A discriminated sub-shape**, `order_line` plus
  `order_line_rental_detail` / `order_line_purchase_detail`. More correct,
  meaningfully more migration and router work.

Take the first unless purchase-specific fields start accumulating. This codebase
has a precedent for not over-modelling ahead of need: the `project_phase` table
was deleted for exactly that reason, and the comment explaining why is still in
the project schema.

### 4. Our own order numbers

The point of the whole exercise. Today `externalNumber` holds the *vendor's*
number — its comment calls it "what you quote back to them on the phone". That
stays.

Add Urban's own number alongside it:

```
orderNumber   text   'UIC-PO-00042'   unique per tenant
```

generated by a per-tenant sequence. Both numbers on one row is the hinge: Urban
issues `UIC-PO-00042`, sends it to United Rentals, stores their contract number
against it when they respond, and from then on either number finds the order.
That is what lets the desk track an order from this system while still being able
to walk into the vendor's own portal and quote a number they recognise.

## Integration with United Rentals

Worth being clear that this is a later, separate thing.

The import path already handles their portal exports — vendor auto-creation,
their order-type vocabulary, MM/DD/YYYY date normalisation, dedupe on
`(vendorId, externalNumber)`. That is a working integration and it costs nothing
per month.

A real API integration means an account conversation with United Rentals, not an
engineering task, and it should not gate any of the above. Build against the
export, and treat API access as a negotiation that may or may not conclude.

## Suggested sequence, when this is picked up

1. Vendors screen and `vendorRouter` — standalone, useful immediately, no schema
   change beyond permissions
2. Vendor dedupe/merge, since the screen will surface the problem
3. `asset.purchasedFromVendorId` — enables vendor spend on owned tools
4. Rename and generalise the order tables
5. Urban-issued order numbers
6. Purchase order creation UI — the first point at which the system can place an
   order rather than only record one

Steps 1 and 3 deliver most of the value. Everything after is what turns the
register into something that can originate a transaction rather than only
receive one.
