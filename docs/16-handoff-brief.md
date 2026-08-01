# Handoff brief

Everything below is context for an implementer picking up docs 11 to 14 and 17.
Read this first, then the phase document for whatever you are building.

## The repository

`STInventory` — small-tools inventory for Urban Infraconstruction, a Dallas
construction company. Tracks who is holding which tool, on which job, and what
it cost. Live at `urban.bodhitechlabs.com`.

pnpm workspaces + turbo. TypeScript throughout.

```
apps/api        Hono + tRPC server, Drizzle/Postgres. Also a REST surface in
                src/rest-routes.ts for the mobile app.
apps/web        Next.js 15 App Router, Tailwind, shadcn-style components
apps/mobile     Expo, served as a static web bundle at /field
packages/db     Drizzle schema, migrations, seed
packages/types  Enums, permissions, import specs. Both apps depend on this.
packages/api-contracts  tRPC routers. The API surface lives here, not in apps/api.
packages/domain Pure rules, unit tested. No I/O.
packages/intent Chat message -> intent parsing, LLM prompt, catalog
packages/auth   Sessions, bcrypt, AES-GCM secret encryption
```

`packages/frontend-shared` exists and is **dead** — nothing depends on it and
nothing imports it. Do not put shared code there and do not trust its types as a
description of anything. It misled a previous pass.

## The one idea you must hold

The `transaction` table is an append-only ledger and the source of truth. The
`current_*` columns on `asset` are a **projection** — a cache folded from that
ledger. Every write that moves a tool must update both, consistently, or the
register and its own audit trail disagree and the disagreement only surfaces
when somebody rebuilds.

There is a history of bugs from exactly this: writers updating the projection
but writing a partial `toState` into the ledger. The fold is last-snapshot-wins,
so a partial snapshot blanks whatever it omits. **When you write a
`transaction`, write the complete state after the move, never just the field you
changed.**

`packages/api-contracts/src/custody.ts` is the single place a custody link opens
or closes. Route every custody change through `moveCustody`. Do not insert into
`assignment` directly.

## Conventions that are load-bearing

**Comments explain why, not what.** This codebase's comments are unusually
dense and they carry real decisions — why a table was deleted, why a gate was
removed, why a default is what it is. Match that. A comment saying
`// set the status` is noise; a comment saying why this path does not need
approval is the thing that stops the next person reintroducing a bug.

**No emojis anywhere.** Not in code, comments, commit messages or UI.

**Field UX simplicity is a hard constraint.** Foremen and superintendents get a
three-item navigation (`FIELD_NAV` in `apps/web/components/sti/nav-config.ts`)
and a chat box. Everyone else gets the desk. Do not add fields to a foreman's
path without a reason you can defend; do not add `mechanic` to `FIELD_ROLES`.

**Reports are the product's moat.** Every module ships reports first. Do not
lose a report category.

**Permissions are enforced server-side** by `requirePermission` in
`packages/api-contracts/src/trpc.ts`. Hiding a nav item is cosmetic.

## Verify with

```bash
pnpm typecheck   # all 12 packages. This is the primary instrument.
pnpm test        # vitest: domain, intent, api-contracts, types, auth
pnpm lint
```

Typecheck must be clean and currently is. For a change touching a hundred call
sites, a clean typecheck is most of your proof — lean on it, and do not silence
an error with `any` or a cast to get moving.

Migrations:

```bash
pnpm --filter @stinventory/db generate   # diffs schema/*.ts -> new numbered SQL
pnpm --filter @stinventory/db migrate    # applies
```

Never hand-edit `packages/db/drizzle/meta/`. Do hand-add data statements
(seeds, backfills) to a generated migration file when the phase document says
to. The API container runs `migrate` on boot and **refuses to serve if it
fails**, so a bad migration takes the site down. Test against a local Postgres
first.

## What was just finished, and must not regress

A foreman handing a tool to another foreman used to auto-approve itself and
write a **permanent** ownership change. It now:

- applies immediately as a `temporary` link (the tool has physically moved; the
  register should say so)
- leaves permanent ownership alone — `homeCustodianId()` in `custody.ts` reads
  it back from history
- lands in the equipment desk's queue as `pending_verification` for
  verify / make-permanent / reject

The rule is `custodyOutcome()` in `packages/domain/src/rules.ts`, returning
`auto | verify | approve` based on the actor's permission first and value
second. It is unit tested. **Do not** reintroduce a value-only gate, and do not
let cost-attribution work (doc 11) touch this path — cost target lives on
`asset`, is set once at registration, and is orthogonal to custody.

## Known-good starting state

Typecheck, tests and lint are all clean as of the last commit. If they are not
clean when you start, something is wrong with your environment, not the code.

## Read the phase document before writing anything

Each of docs 11 to 14 and 17 names the exact files, gives the schema changes as
Drizzle columns, and flags the specific places where a rename is not enough.
Those flags are there because somebody already checked; they are not
speculation.

Docs 12 and 17 both alter `asset`. Build them together and generate **one**
migration, not two.

Doc 15 is a roadmap, not a build order. Do not implement it.
