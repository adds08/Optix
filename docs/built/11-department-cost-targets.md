# Charging a tool to a department

Every tool in the register is charged to a project. `asset.owningProjectId` is
the column, and its comment calls it the financial capital owner, immutable
once set. That works for the tools a foreman carries, because a foreman is
always on a job.

It does not work for a mechanic. Urban's equipment department has its own
mechanics, and the tools they hold are not on anybody's job — they are shop
tools, and their cost belongs to Repair & Maintenance. Today there is nowhere
to put that. The field does not exist, so a mechanic's grinder either gets
charged to whatever project it last touched or to nothing at all, and the
capital reports are wrong by exactly that much.

This adds a second kind of cost target alongside the project, and a `mechanic`
role that can hold tools.

## What is not changing

The cost target is **fixed to the asset and set once**, exactly like
`owningProjectId`. It is not per hand-off. A tool lent from a mechanic to a
foreman for an afternoon does not change what it is charged to, any more than
lending it changes who paid for it.

This matters because it keeps the change out of the custody path entirely.
`moveCustody`, `custodyOutcome`, `homeCustodianId`, `transfer.create`,
`transfer.verify` and the whole borrow/verification flow are untouched. Cost
attribution and custody tracking are orthogonal, and the moment they are not,
every report needs a temporal join to answer "what is this charged to".

## The naming problem, decided

Three things in this codebase want to be called the same thing:

| Existing | Where | What it actually is |
|---|---|---|
| `project.costCenter` (removed 2026-08-29 — it was unused, see below) | `packages/db/src/schema/project.ts` | A GL code string on a project, typed by a person, fed from FoundationSoft |
| `task.department` | `packages/db/src/schema/task.ts` | A chat-routing label — "Maintenance", "Procurement" — deciding which desk sees a task |
| the new table | this document | A financial cost target for tools that are not on a job |

The new table is `department`. Calling it `cost_center` collided at the time
with `project.costCenter`, a literal string field nobody ever wrote through
the UI — that column was dropped 2026-08-29 for exactly that reason, so this
naming collision no longer exists in the live schema. The reasoning below is
kept as the record of why `department` was named what it was, not as a live
warning.

## Schema

New file `packages/db/src/schema/department.ts`:

```ts
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";

/*
  Who pays for a tool when it is not a job.

  Mirrors `project` as a financial target, not an operational one — mechanics
  work out of the shop, not a site, and their tools still have to be charged to
  something.

  Distinct from `task.department` (a chat-routing label) — that is not this.
  A GL code string on `project` itself (`costCenter`) existed briefly and was
  dropped 2026-08-29 as unused; this table is not a replacement for it and
  never was.
*/
export const department = pgTable(
  "department",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /* Short code for reports and exports — "RM". Optional; the name is the
       identity, this is a convenience. */
    code: text("code"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("department_tenant_idx").on(t.tenantId),
    tenantNameUq: uniqueIndex("department_tenant_name_uq").on(t.tenantId, t.name),
  }),
);
```

Export it from `packages/db/src/schema/index.ts`. Order matters only for
self-referencing tables, so add `export * from "./department";` before
`./asset` (asset references it).

Two columns on `asset` in `packages/db/src/schema/asset.ts`, beside
`owningProjectId`:

```ts
/* Which kind of thing pays for this tool. Set at registration and meant to
   stay put, like owningProjectId — see docs/built/11-department-cost-targets.md. */
costTarget: text("cost_target").notNull().default("project"), // 'project' | 'department'
owningDepartmentId: uuid("owning_department_id").references(() => department.id, { onDelete: "restrict" }),
```

`onDelete: "restrict"` on purpose. `project.delete` already refuses to drop a
project that assets still name as their capital owner; a department with tools
charged to it should be equally undeletable rather than silently orphaning
them.

`owningProjectId` is not touched — it stays nullable, no new constraint.

### Why no CHECK constraint

The obvious database-level rule is: `costTarget='project'` implies
`owningProjectId` set and `owningDepartmentId` null, and the reverse. Do not add
it in this migration.

`owningProjectId` is optional at create today (`routers/asset.ts`), so existing
rows can have neither set, and a strict CHECK would fail to apply without a
backfill pass this feature does not otherwise need. Enforce it in the router's
zod schema instead, where a violation is a form error rather than a Postgres
exception. Revisit once real data is loaded and the invariant is known to hold.

## Migration

```
pnpm --filter @stinventory/db generate
```

That produces `packages/db/drizzle/00NN_<slug>.sql`. Hand-add a seed and an
explicit backfill to the generated file:

```sql
-- One department every tenant needs on day one.
insert into department (tenant_id, name, code, is_active)
select id, 'Repair & Maintenance', 'RM', true from tenant
on conflict do nothing;

-- Explicit rather than relying on the column default, so the intent is in the
-- migration history and not only in the schema file.
update asset set cost_target = 'project' where cost_target is null;
```

Then `pnpm --filter @stinventory/db migrate`. Note the API container runs this
on boot and refuses to serve if it fails, so verify against a local Postgres
first.

## Types

`packages/types/src/enums.ts`:

```ts
export const EMPLOYEE_ROLES = [
  "foreman",
  "superintendent",
  "pm",
  "equipment_admin",
  "warehouse",
  "mechanic",      // NEW
  "procurement",
  "hr",
  "finance",
] as const;

export const COST_TARGETS = ["project", "department"] as const;
export type CostTarget = (typeof COST_TARGETS)[number];

/* Roles that can hold a tool. Foremen carry them to jobs; mechanics keep them
   in the shop. Every custodian picker reads this rather than testing for
   "foreman" itself — three of them had drifted apart before it existed. */
export const CUSTODIAN_ROLES = ["foreman", "mechanic"] as const;
```

**Do not add `mechanic` to `ROLES` in `packages/types/src/index.ts`.** That is a
different list: `EMPLOYEE_ROLES` drives `employee.role`, the domain record of a
person who can hold a tool. `ROLES` drives RBAC — logins, `role_permission`,
`user_role` — and is keyed exhaustively in `seed.ts`'s `ROLE_PERMS`, so adding
to it will not compile until somebody decides what a mechanic's own login may
see. Mechanics need to be *selectable as a custodian*, not to log in. If they
later need logins, that is its own change.

Two new permissions in `packages/types/src/index.ts` `PERMISSIONS`:

```ts
"department.read",
"department.manage",
```

`seed.ts` needs no change for these. `ROLE_PERMS` gives `owner` and
`equipment_admin` `[...PERMISSIONS]`, so anything added to that array reaches
both automatically. Decide deliberately whether `warehouse` should get
`department.read` — its grant is an explicit list, so it will not pick these up,
and a warehouse clerk who cannot read departments will see blank cost targets on
the register.

## Custodian pickers

Three places hardcode `role === "foreman"` and all three must widen, or the
feature is half-built:

| File | What breaks if missed |
|---|---|
| `apps/web/components/assign-form.tsx` | Cannot assign a tool to a mechanic from the desk |
| `apps/web/components/transfer-form.tsx` | Cannot transfer a tool to a mechanic |
| `apps/api/src/entity-resolve.ts` (`resolveCustodian`) | A mechanic named in a chat message silently fails to resolve — the message lands in manual review with no explanation |

The third is the easy one to miss and the worst to lose: it is the chat path, and
chat is the surface the field actually uses.

Pseudocode, same shape in all three:

```
// before
where: employee.role === "foreman"

// after
import { CUSTODIAN_ROLES } from "@stinventory/types";
where: inArray(employee.role, CUSTODIAN_ROLES)     // server (drizzle)
where: CUSTODIAN_ROLES.includes(e.role)            // client filter
```

Leave alone:

- `apps/web/components/vehicle-form.tsx` — trucks and trailers go to foremen. A
  mechanic working out of the shop is not who a trailer is assigned to.
- `apps/web/components/sti/nav-config.ts` `FIELD_ROLES` — mechanics are
  desk-side. Adding `mechanic` there would hand them the three-item field nav
  instead of the desk layout.
- `apps/web/components/employee-form.tsx`'s superintendent-linking block — that
  stays foreman-only. Mechanics report to the shop, not a superintendent. Do add
  `mechanic` to the role dropdown itself.

## Department router

New `packages/api-contracts/src/routers/department.ts`, modelled on
`routers/project.ts`:

```
list   protectedProcedure + department.read
       -> select id, name, code, isActive from department
          where tenantId = ctx.session.tenantId and isActive
          order by name

create requirePermission("department.manage")
       input { name: string 1..120, code?: string max 20 }
       -> insert, logEvent({ category: "department", action: "create" })

update requirePermission("department.manage")
       input { id: uuid, name?, code?, isActive? }
       -> update where id and tenantId, logEvent
```

Register it in the root router next to `project`.

## Asset router

Add to both `create` and `update` inputs in
`packages/api-contracts/src/routers/asset.ts`:

```ts
costTarget: z.enum(COST_TARGETS).default("project"),
owningDepartmentId: z.string().uuid().nullable().optional(),
```

`create` spreads `...input` straight into the insert, so the new fields flow
through with no further change there. `update` destructures `{ id, ...changes }`
and applies `changes`, likewise.

Then a `superRefine` on both, enforcing exactly one target:

```
superRefine((v, ctx) => {
  if (v.costTarget === "project" && v.owningDepartmentId)
    error on owningDepartmentId: "A tool charged to a project cannot also name a department."
  if (v.costTarget === "department" && !v.owningDepartmentId)
    error on owningDepartmentId: "Say which department pays for this tool."
  if (v.costTarget === "department" && v.owningProjectId)
    error on owningProjectId: "A tool charged to a department cannot also name a project."
})
```

On `update`, `costTarget` is optional, so read the existing row first and refine
against the merged shape rather than the patch alone — otherwise clearing a
project while switching to department passes validation in two separate calls
that each look fine.

## Asset form

`apps/web/components/asset-form.tsx` has one "Owning project" select. Replace it
with a toggle and two conditional selects:

```
[ Project | Department ]      <- segmented control, bound to costTarget

when "Project"     (default)
  <select owningProjectId>    required, unchanged from today
when "Department"
  <select owningDepartmentId> from trpc.department.list,
                              defaulted to the "Repair & Maintenance" row
```

Switching the toggle clears the other field, so a submitted form never carries
both. The `AssetEditable` type and both `create`/`update` mutate calls gain
`costTarget` and `owningDepartmentId`.

This is the only new field a desk user sees, and foremen never see this form at
all — it defaults to Project, so the common path is unchanged.

## Reports

Two additions to `packages/api-contracts/src/routers/report.ts`.

`capitalByDepartment`, a direct mirror of `capitalByProject` — same shape, same
`coalesce(sum(...))`, grouping on `owningDepartmentId`:

```ts
capitalByDepartment: protectedProcedure.query(async ({ ctx }) => {
  const tid = ctx.session.tenantId;
  return ctx.db
    .select({
      departmentId: schema.department.id,
      departmentName: schema.department.name,
      assetCount: sql<number>`count(${schema.asset.id})`,
      capitalValue: sql<string>`coalesce(sum(${schema.asset.acquisitionCost}::numeric),0)`,
    })
    .from(schema.department)
    .leftJoin(schema.asset, and(
      eq(schema.asset.owningDepartmentId, schema.department.id),
      eq(schema.asset.tenantId, tid),
    ))
    .where(eq(schema.department.tenantId, tid))
    .groupBy(schema.department.id, schema.department.name);
}),
```

`byMechanic`, a copy of `byForeman` with the role filter changed to
`"mechanic"`. **Leave `byForeman` exactly as it is.** Parameterising one query
by role would make a report whose meaning changes with a flag; two near-identical
queries are cheaper to read and cheaper to be wrong about.

Register both in `apps/web/app/(app)/reports/registry.ts` and add branches to
the existing if/else chain in `apps/web/app/(app)/reports/[slug]/page.tsx`.

## Order of work

1. `packages/db/src/schema/department.ts` (new), export from `schema/index.ts`
2. `packages/db/src/schema/asset.ts` — two columns
3. `packages/types/src/enums.ts` — `mechanic`, `COST_TARGETS`, `CUSTODIAN_ROLES`
4. `packages/types/src/index.ts` — two permissions
5. `generate`, hand-add seed + backfill, `migrate`
6. `packages/db/src/seed.ts` — seed the department row and a demo mechanic
   employee. `ROLE_PERMS` needs no edit unless `warehouse` is to get
   `department.read`
7. `packages/api-contracts/src/routers/department.ts` (new) + root router
8. `packages/api-contracts/src/routers/asset.ts` — inputs + superRefine
9. `packages/api-contracts/src/routers/report.ts` — two queries
10. Custodian pickers: `assign-form.tsx`, `transfer-form.tsx`, `entity-resolve.ts`
11. `apps/web/components/employee-form.tsx` — mechanic in the role dropdown
12. `apps/web/components/asset-form.tsx` — the toggle
13. `reports/registry.ts`, `reports/[slug]/page.tsx`

## Verification

- `pnpm typecheck` clean across all packages. This is what catches a missed
  call site; the previous custody change was verified the same way.
- Register a tool with cost target Department and confirm it appears in
  `capitalByDepartment` and not in `capitalByProject`.
- Assign that tool to a mechanic from the desk form.
- Say "gave the grinder to Dave" in chat, where Dave is a mechanic, and confirm
  it resolves rather than dropping to manual review — this is the
  `entity-resolve.ts` change and it is the one with no compile-time signal.
- Confirm a foreman logging in still sees the three-item field nav, not the desk
  nav, and that the asset form still defaults to Project.
