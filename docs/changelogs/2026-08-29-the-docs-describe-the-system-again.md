# The docs describe the system again, and v1.0.0 gets a name

A lot has shipped in a short time, and the documentation had stopped keeping up in
a specific and dangerous way: **not one document anywhere in the repository
mentioned the `tbl_` prefix.** The 2026-08-28 rename gave every table a new
physical name, and every schema reference in `docs/` was still describing `asset`,
`assignment` and `transaction` — names that no longer exist. Nothing about those
documents looked wrong.

So: reconcile, delete what earns deleting, and write a set of architecture
documents derived from the code rather than from the previous documents. Then tag
what is there as v1.0.0.

## What changed

### A new `docs/architecture/`, derived rather than transcribed

Five documents, each naming the source it was read from:

- **`01-data-model.md`** — the naming convention, tenancy, the ledger-is-truth
  idea, an ER diagram and the tables by area. **The foreign-key graph was
  extracted from the `.references()` calls by a script**, not typed out, which is
  the only reason it can be trusted to be complete.
- **`02-backend.md`** — the process shape, the deliberately-small HTTP surface,
  every router and its procedures, the custody chokepoint and its compile-time
  enforcement, the high-value gate, the three workers.
- **`03-frontend.md`** — the two clients, the route map, the shell, the table
  system, theming, and which state lives where.
- **`04-data-flow.md`** — four sequence and flow diagrams: a tool changing hands,
  ledger versus projection, a foreman speaking in chat, and reading anything back
  through the three gates.
- **`05-features.md`** — the product feature by feature, each marked **built**,
  **built but unreached**, or **not built**, with the screens, procedures and
  tables it actually uses.

Its README states the deal these have and the older documents do not: they
describe the *present*, so they must be corrected whenever the code moves, whereas
`built/` and `changelogs/` are dated records that must never be brought up to date.

### `docs/CODEMAP.md`

Where things are and what to read before touching them, for somebody arriving
cold. The repository layout, the files that carry invariants paired with the rule
file that governs each, an "I want to… → start at…" table, and the commands.

It carries the `pnpm test` warning prominently, because a green run on a host with
no database means the custody, RBAC and tenant-isolation suites did not execute.

### `docs/changelogs/INDEX.md`

Every entry, newest first, grouped by month — **generated from the directory**, so
it cannot disagree with it.

### Deleted

- **`docs/codegen/` and `docs/codegen-jobsites/`** — verbatim copies of components
  that shipped weeks earlier. Checked before deleting rather than assumed: the
  jobsites page had gone from 452 lines in the copy to 1058 live, `rig-picker`
  from 243 to 438. A stale copy of live source inside a docs folder is the worst
  kind of stale doc, because it looks authoritative.
- **`docs/features/`** — a README describing a four-file-per-ticket convention that
  no ticket ever used. `changelogs/` does that job and is the convention in use.

### Archived and flagged

`03-data-model.md` moved to `archive/` with a banner at the top saying plainly that
its table names no longer exist. Kept rather than deleted because its Part B is
still the best written account of the design that was deliberately not built.

Six documents that `README.md` lists as current still reference pre-rename table
names in passing — `06-decisions.md`, `07-conversational-layer.md`,
`02-saas-architecture.md`, `15-vendors-and-orders.md`, `09-vocabulary.md`,
`05-build-proposal.md`. Their *reasoning* is unaffected and rewriting them would
have meant editing prose whose argument is still correct, so each carries a short
banner naming the rename and pointing at the new schema document.

### v1.0.0

`CHANGELOG.md` gains a release entry — "Optix for small tools implemented" — that
says what the release is and, more usefully, lists what is knowingly incomplete at
the tag: the wall-board dashboard on a phone, the paginated CSV export, the role
flags the navigation still ignores, invite email never pointed at a mailbox, and
the four features that are not built.

## What was found while building it

**The gap was total, not partial.** `grep -rl "tbl_" docs/ SYSTEM_PLAN.md AGENTS.md`
returned nothing at all. Not one document had been updated after the rename. That
is a better argument for generating reference material from the source than any
amount of discipline.

**One claim in the first draft of the frontend document was wrong.** It named
`components/use-permissions.tsx`; the file is `components/use-permissions.ts`.
Caught by checking every path the drafts asserted rather than by reading them
back — which is the point: the check found something, so it was worth running.

**`CLAUDE.md`'s seed example is now historical.** It says the seed carries no
acquisition costs, so the high-value gate could not be exercised. STI-108 fixed
that — the seed now carries an asset priced at exactly the threshold. The passage
reads as a past-tense cautionary example, so it is not wrong, but anyone quoting it
as current state would be.

## Verified

- Every table name, router, procedure, permission and web route in the new
  documents was extracted from the source by script, not transcribed.
- Every file path asserted in the new documents was checked to exist; one did not
  and was corrected.
- The append-only trigger, the `assignment_one_active_uq` index, the composite
  vehicle foreign keys and the `max: 10` pool size were each confirmed in the
  source before being written down.
- The three codegen components were diffed against their live counterparts before
  deletion.

**Not verified:** the mermaid diagrams have not been rendered. They are
syntactically ordinary and GitHub renders them, but nobody has looked at the
picture.

## Deliberately not done

- **The historical documents were not rewritten.** `HANDOFF-RELEASE-1.md` and
  `RELEASE_1_SPRINT_PLAN.md` reference old table names and are dated records; a
  record corrected after the fact is no longer a record.
- **`SYSTEM_PLAN.md` was not restructured.** It remains the entry point and it is
  not wrong; the architecture documents sit underneath it rather than replacing it.
- **No counts anywhere.** Not of tables, routes, tests or procedures — the repo
  convention, and the reason the new documents name their source instead.
- **Onboarding and in-product guidance** — explicitly next, not now.

## Where it is

Branch `development`, tagged `v1.0.0`.
