# Tags are optional, and only exist when somebody makes one

`asset.tag` is `not null`, required on create, required on import, and the
primary way every screen identifies a tool. Urban's own records have no tag
column at all — the trailer sheets identify a tool by its serial number and, for
some categories, by an equipment number in an unlabelled column.

That mismatch blocked the entire import path: a real sheet gets through header
matching and then fails because `tag` is required and not in the file.

## Identity is the id; the tag is a label

Every asset already has a unique identity and always has: `asset.id`, a uuid
primary key, generated on insert, never null, never reused. Every other entity
in the schema works the same way. Nothing about this change touches identity,
because identity was never the tag's job.

A tag is a **label** — the thing physically written or stuck on the tool so a
person in the yard can say it out loud. It exists in the register only once
somebody has put it on the tool. A tool with no label has no tag, and that is a
normal state, not a gap.

That distinction decides everything below:

| | `asset.id` | `asset.tag` |
|---|---|---|
| What it is | The entity's identity | A label on a physical object |
| Assigned by | The database, on insert | A person, with a label maker |
| Always present | Yes | No |
| Unique | Yes, by construction | Yes, enforced in app code |
| Sequential | No, and never | No, and never |
| Safe to invent | Yes — nobody reads it | No — it must match the tool |

This supersedes the "generate the tag on import" recommendation in
`docs/built/13-excel-round-trip.md`, which is now wrong — do not build it.

## Why the system must not invent a tag

A generated `UIC-2001` in the database that is not written on the tool is a
number nobody in the yard can read off the thing in their hands. It would be
right in the register and absent in reality, and every conversation about it
would go "which one is UIC-2001?"

There is no need for it either, since the id already guarantees the row is
distinguishable. Inventing a tag buys nothing the id does not already give and
costs a number that lies.

It also hides the real state. If the register cannot distinguish "labelled" from
"not labelled yet", nobody can produce the list of tools that still need labels
— which is the actual work this data implies.

The same reasoning rules out **suggesting** a next tag in sequence. A sequence
implies the tags are an allocation the system owns, which invites somebody to
accept the suggestion without labelling the tool, and puts the register straight
back into the state above. Whoever adds a tag types what is on the label, and
nothing else.

## Schema

One change in `packages/db/src/schema/asset.ts`:

```ts
/* A tag is a physical label on the tool, not an id the system assigns. Null
   means nobody has labelled it yet — a normal state for anything imported from
   the yard's own sheets. See docs/built/17-optional-tags.md. */
tag: text("tag"),
```

Note `asset_tag_idx` is a **plain index, not unique** — tag uniqueness has
always been enforced in application code, never by the database. That does not
change here, and it is why this migration is small.

Fold this into the same migration as `docs/built/12-model-field-split.md`; both alter
`asset` and there is no reason to touch it twice.

```sql
alter table asset alter column tag drop not null;
```

No backfill. Existing rows keep their tags.

## The uniqueness rules already handle null

Both places that enforce tag uniqueness are already null-safe, which is why this
is not a large change:

`packages/api-contracts/src/routers/import.ts` skips blanks in its unique loop:

```ts
if (!col || typeof val !== "string" || !val) continue;
```

`packages/api-contracts/src/routers/asset.ts` guards its update clash check:

```ts
if (changes.tag && changes.tag !== existing.tag) { ... }
```

Neither needs changing. Confirm both still behave when you make the column
nullable rather than assuming it.

## What identifies an untagged tool

This is the part that needs design, not just a nullable column.

**Do not edit 111 call sites.** Almost all of them are
`<Tag>{a.tag}</Tag>`, and the right change is to the `Tag` component in
`apps/web/components/sti/status.tsx` so every one of them handles the null case
without being touched:

```tsx
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  /* An untagged tool is a normal state, not missing data — it is a tool nobody
     has put a label on yet. Rendering an empty pill would read as a bug, and
     rendering nothing would leave the row with no left-hand column at all. */
  const empty = children === null || children === undefined || children === "";
  return (
    <span
      className={cn(
        "tag-num rounded-sm px-1.5 py-0.5",
        empty ? "bg-transparent text-muted-foreground italic" : "bg-muted text-foreground",
        className,
      )}
    >
      {empty ? "no tag" : children}
    </span>
  );
}
```

`apps/mobile/components/ui.tsx` has its own `Tag` with the same
`{ children }` shape, used at five sites in the same `<Tag>{x.tag}</Tag>`
pattern. It needs the same treatment and gets the same benefit — five call sites
untouched.

Beyond that, the register and the tool detail page should show the serial number
as the secondary identifier, since for an untagged tool it is the only thing
that identifies it in the world. Most screens already have serial available in
the query.

## Creating a tag later

The other half of "tags that are created". A tool arrives untagged from a sheet;
somebody labels it in the yard; the register needs to catch up.

`asset.update` already accepts `tag` and already checks for a clash, so the
mutation exists. What is missing is a path to it that makes sense to the person
holding the label gun:

- On the tool detail page, an untagged tool shows an **Add tag** action rather
  than requiring a trip through the full edit form.
- The field is **empty**, with no suggested value. Whoever is adding it reads
  what is on the label and types that. See above for why a suggestion is worse
  than nothing here.
- The existing clash check applies, so a label already in use is rejected with
  the tag named. That is the only validation — a tag has no format the system
  should enforce, because the yard's labels are the yard's to choose.
- A **Needs a tag** report: every asset where `tag is null`, which is the
  worklist for whoever is doing the labelling.

Add the report to `packages/api-contracts/src/routers/report.ts` and
`apps/web/app/(app)/reports/registry.ts`, mirroring `idle`.

## Import consequences

In `packages/types/src/import-specs.ts`, drop `required: true` from the `tag`
column and update its hint:

```ts
{ key: "tag", header: "tag", type: "text", example: "UIC-2001",
  hint: "Your asset tag, if the tool has one. Leave blank if it is not labelled yet." },
```

`unique: ["tag", "serialNumber"]` stays as-is — the loop skips blanks, so
untagged rows simply do not participate in tag deduplication.

**The consequence worth stating plainly:** a row with neither a tag nor a serial
number cannot be deduplicated at all, so re-importing the same sheet will create
duplicates of those rows. Three rows on the sample TE-006 sheet have no serial.
There is no clean fix — dedupe needs something stable to match on, and such a
row offers nothing. Warn in the import preview when a row has neither, so the
person importing knows before committing rather than after.

## Chat

`apps/api/src/entity-resolve.ts` and `packages/api-contracts/src/apply-action.ts`
both look a tool up by exact tag. Those keep working — they simply never match
an untagged tool, which is correct, because a foreman cannot say a tag that is
not written on anything.

Untagged tools remain reachable in chat through the fuzzy match on
make/model/description added by `docs/built/12-model-field-split.md`, and by serial.

The intake path in `apply-action.ts` currently throws if a draft has no tag.
That should relax to match the new rule: a registration with a description and
no tag is valid. Check `applyIntake` and the intake gate in
`apps/api/src/messaging-worker.ts` together — they must agree, or a card that
passes the gate fails on confirm.

## Order of work

1. `packages/db/src/schema/asset.ts` — drop `not null`, in doc 12's migration
2. `packages/api-contracts/src/routers/asset.ts` — `tag` optional on create
3. `apps/web/components/sti/status.tsx` — `Tag` handles the empty case
4. `packages/types/src/import-specs.ts` — `tag` no longer required
5. `apply-action.ts` and `messaging-worker.ts` — intake no longer demands a tag
6. Tool detail page — "Add tag" action, empty field, no suggested value
7. `report.ts` + registry — "Needs a tag"
8. Import preview — warn on rows with neither tag nor serial

## Verification

- Import the real TE-006 sheet with no tag column. It should now commit, where
  before it failed the required-column check.
- Confirm the register shows those tools with a muted "no tag" rather than an
  empty cell.
- Add a tag to one from its detail page. Confirm the field opens empty with no
  suggested value, and that the clash check still rejects a tag already in use.
- Confirm an untagged tool is still fully usable — assignable, transferable,
  findable, and present in reports. Its `id` is its identity; nothing should
  degrade because it has no label.
- Re-import the same sheet. Rows with serials should deduplicate; note which
  rows duplicate and confirm they are the ones with neither tag nor serial.
- In chat, refer to an untagged tool by description and confirm it resolves.
- Check "Needs a tag" lists exactly the untagged tools.
