# Backend architecture

**Derived from `apps/api/src/*` and `packages/api-contracts/src/*`.** Router and
procedure names below were extracted from the source, not transcribed.

## Shape

One Node process. Hono serves HTTP; tRPC is mounted inside it and is where
essentially all of the product lives. Postgres is the only datastore.

```
apps/api            the process — HTTP surface, workers, storage, rate limiting
packages/api-contracts   every tRPC router, the custody chokepoint, chat actions
packages/domain     pure rules — the fold, the custody gate, reconciliation
packages/intent     the chat intent catalogue and parser
packages/auth       sessions, password hashing, token issue and consume
packages/db         Drizzle schema, migrations, seed, the permission matrix
packages/mail       SMTP transport and the message bodies
packages/env        validated environment, server and client halves
packages/types      enums and permission names shared by every layer
packages/logger     structured logging
```

`domain`, `intent` and `types` are **pure** — no database, no network, no
fixtures. That is what makes them trivially testable and is why "there is no
excuse for an untested domain rule" is a standing rule rather than an aspiration.

## The HTTP surface is deliberately small

The Hono app serves `/health`, the auth endpoints, two asset-photo endpoints, and
tRPC. **Nothing else.**

There was once an `/api/*` REST surface duplicating tRPC procedures without their
permission checks. It is gone. If you are hunting for an ungated mutation, it is
not there — both photo endpoints check the session, then `asset.manage`, then
scope every read and write by `tenant_id`.

| Route | What it does |
|---|---|
| `GET /health` | Liveness |
| `POST /auth/login` | Rate-limited; issues a session |
| `POST /auth/logout` | Revokes it |
| `POST /auth/forgot-password` | Issues a reset token, mails it |
| `GET /auth/tokens/:token` | Reads an invite or reset token without consuming it |
| `POST /auth/tokens/:token/consume` | Sets the password, consumes the token |
| `POST /assets/:id/photo` | Upload, session + `asset.manage` + tenant-scoped |
| `/trpc/*` | Everything else |

## tRPC

`appRouter` in `packages/api-contracts/src/index.ts` composes the routers.

| Router | Procedures |
|---|---|
| `identity` | `me` |
| `user` | `list`, `roles`, `create`, `invite`, `resendInvite`, `setRole`, `setActive`, `resetPassword`, `changePassword` |
| `role` | `catalogue`, `list`, `options`, `setFlags`, `setPermissions`, `create`, `delete` |
| `asset` | `list`, `get`, `create`, `update`, `bulkUpdate`, `delete`, `setStatus`, `verifyProjection`, `rebuild` |
| `assignment` | `list`, `create`, `approve`, `decline`, `return` |
| `transfer` | `list`, `create`, `approve`, `decline` |
| `transaction` | `list` |
| `departure` | `preview`, `reassign` |
| `project` | `list`, `create`, `update`, `delete` |
| `employee` | `list`, `create`, `get`, `postings`, `assignToProject`, `update`, `delete`, `myForemen` |
| `projectTeam` | `all`, `assign`, `remove` |
| `projectGroup` | `mine`, `list`, `create`, `update`, `delete`, `setProjects`, `setUsers`, `userOptions` |
| `department` | `list`, `create`, `update` |
| `category` | `list`, `create`, `rename`, `delete`, `adoptInUse` |
| `location` | `list`, `create`, `update`, `delete`, `setCustodian` |
| `vehicle` | `list`, `create`, `update`, `delete`, `updateGps` |
| `dashboard` | `kpis`, `recentActivity`, `clearanceQueue`, `awaitingDesk`, `briefing`, `pendingApprovals`, `notifications`, `charts` |
| `report` | `assetRegister`, `byProject`, `byForeman`, `byMechanic`, `idle`, `lost`, `needsTag`, `capitalByProject`, `capitalByDepartment`, `auditTrail` |
| `messaging` | `listChannels`, `messages`, `send`, `confirmAction`, `manualEntry`, `dismiss`, `pendingActions`, `feed` |
| `inbox` | `classified`, `resolve`, `dismiss`, `retryClassify` |
| `task` | `list`, `get`, `create`, `update`, `delete`, `approve`, `decline` |
| `action` | `submit` |
| `entity` | `suggest`, `search` |
| `import` | `preview`, `commit` |
| `notification` | `list`, `all`, `markRead` |
| `settings` | `get`, `update`, `testLlm`, `testEmail` |
| `preferences` | `get`, `set` |

**The tRPC type is the contract.** It flows straight into both clients, so a shape
change is a client change and `pnpm typecheck` is the only thing between a router
edit and a broken app.

### Permissions

`requirePermission("asset.read")` is the normal way a procedure is declared;
`protectedProcedure` alone means "authenticated, no specific right" and a
*mutating* one needs a reason written in the diff.

The permission names live in `packages/types`. The role → permission mapping lives
in **`packages/db/src/role-perms.ts`**, which is the single place it is written
down: `seed.ts` writes it into the database and `rbac-matrix.test.ts` asserts the
database matches it in both directions. The prose version in
`docs/workings/PERMISSION_MATRIX.md` carries the reasoning; when the two disagree,
the code is what the system does.

Roles are seeded as a factory default and are then editable per tenant through
`role.setPermissions` and `role.setFlags`.

## The custody chokepoint

**`packages/api-contracts/src/custody.ts` is the one legitimate writer of custody.**
Never insert or update a `tbl_ops_smalltools_custody` row directly.

- `closeActiveCustody(tx, ...)` and `moveCustody(tx, ...)` take a `Transaction` as
  their first argument. A raw `db` handle is a **compile error** — that is the
  enforcement, and it exists because `db: any` signatures are how bare unwrapped
  writes shipped in the first place.
- Both take `SELECT … FOR UPDATE` on the **asset row** first. It is the
  serialisation anchor because it exists even when no custody row does.
- Decision procedures re-check status *under the lock*. The outside guard is not
  enough: two simultaneous approves both read "pending" before either commits, and
  the loser used to append a duplicate event to an append-only ledger.
- **Never await anything network-shaped inside `db.transaction`.** postgres.js
  pins one pool connection for the life of the transaction (`max: 10`), so an LLM
  call or an email send inside one wedges the pool at ten concurrent operations —
  client-side starvation that Postgres's deadlock detector cannot see.

The full rule set, including the three writer buckets for `to_state` snapshots and
the reasoning behind each, is `.claude/rules/custody-and-ledger.md`. Read it before
editing either file.

## The custody gate

`custodyOutcome` in `packages/domain/src/rules.ts` asks exactly one question — is
this tool worth more than the tenant's high-value threshold?

| Cost | Outcome | Effect |
|---|---|---|
| ≥ threshold | `approve` | Nothing is written until a second signature |
| < threshold, or threshold null | `auto` | Applied immediately |

A null threshold **disables the gate**: a tenant that has not said what "high
value" means has not asked for one. Null cost counts as zero, because imported
rows routinely have no price.

There is no `verify` outcome and no borrow model. Both were removed on 2026-08-09
along with `expected_end_date` — **nothing falls due, so nothing goes overdue.** A
document asking for an overdue view is describing a deleted feature.

## Workers

Three pollers run in the API process, started from `apps/api/src/index.ts`:

| Worker | What it does |
|---|---|
| `messaging-worker` | Picks up queued chat messages, parses intent, resolves entities, applies the action or parks it for a human |
| `request-worker` | Re-queues messages stranded by an unreachable parser, and sweeps rows stuck in `processing` |
| projection sweep | Runs `reconcileProjections` at boot and every six hours, raising a `custody_discrepancy` desk notification per divergence |

The sweep does not dedupe. A register that disagrees with its ledger should keep
nagging.

## Sessions

`packages/auth` issues an opaque session id stored in `tbl_entity_session`;
`resolveSession` resolves it to a user, a tenant and a permission set on every
request. Passwords are hashed there and never leave it.

Tenant LLM keys are AES-GCM encrypted at rest. **No procedure may return
`llm_api_key_enc`**, and adding one is a security bug regardless of who can call
it.

## Tests

Two populations, and knowing which is which matters:

- **Pure**, in `domain`, `intent`, `types` — run anywhere, no setup.
- **Database-backed**, in `api-contracts` — these **skip silently without a
  `DATABASE_URL`**. `pnpm test` on a host with no database prints a green result
  while the custody, RBAC and tenant-isolation suites never ran. Run them inside
  the api container to actually exercise them.

`reachability.test.ts` greps both clients for tRPC procedures nothing calls — the
guard against building a backend feature no screen can open, which has happened.

The browser suite is separate, in `e2e/`, and runs against the Docker stack.
