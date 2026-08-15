# Where STInventory sits

Read alongside `../CLAUDE.md`. This file records what the sibling directories
contain and what follows from it for this codebase — written after reading them,
so decisions here stop being made in isolation from the rest of Urban's stack.

## The neighbours

| Path | What it is | Bearing on STInventory |
|---|---|---|
| `../mark85/` | Prototype of the wider ops platform: timesheets, materials, projects, cost codes. Same stack — pnpm/Turbo, Hono+tRPC, Drizzle, Next 15, Expo. | **Already models projects, phases and cost codes.** See below. |
| `../timesheet/` | Legacy web app (jQuery/Bootstrap/Vue sprinkles). Live. | Equipment module is heavy equipment, not small tools. |
| `../timesheetservice/` | Legacy PHP API (Slim). Live. | Same. `/optix/*` is one small auth route group for an external integration, not a subsystem. |
| `../urbaninfraconstruction-application/` | Legacy Flutter field app. Live. | The app STInventory's field app is philosophically replacing, for tools only. |
| `../FEATURES.md` | Inventory of the legacy system. | The parity baseline — for everything except small tools. |
| `../MARK_85_PLAN.md` | Nine capability pillars. | Pillar 4 is "Equipment & assets". Small tools is not in it. |

## Small tools is a gap, not parity work

"Small tool" appears nowhere in `FEATURES.md` or `MARK_85_PLAN.md`. The legacy
equipment module and Pillar 4 both mean *heavy* equipment: hours capture, fuel,
maintenance schedules, mechanic logs, HCSS/Samsara telemetry, depreciation.

So STInventory is not replacing a legacy screen and not implementing a planned
module. Two consequences:

- There is no legacy report to preserve here. The standing rule "do not lose a
  report category in the legacy → Mark 85 transition" has nothing to bite on in
  this codebase, because no small-tools report ever existed. Reports here are
  new ground, which is freedom, not licence to skip them.
- Nobody has specified this module. The absence of a spec is why "check before
  building" matters more here than elsewhere — there is no document to be wrong
  about, only the operation itself.

## Projects, phases and cost codes are already modelled — next door

`../mark85/packages/db/src/schema/project.ts`:

```
project            branch-scoped, `code` unique per branch ("ACME-2026-001")
project_phase      code, name, sortOrder — unique per (project, code)
cost_code          per-branch library: "03-300 / Concrete Formwork", category, UOM
project_cost_code  join: project + OPTIONAL phase + cost code, with budgets
```

`project_cost_code.phase_id` is nullable, and that is exactly the "No Phase"
case. `FEATURES.md` states the same rule for the live system:

> Project has 0..N Phases (a project may have no phases — modeled as the special
> "no-phase"). Phase has 0..N Cost Codes (or a no-phase project's cost codes
> attach directly).

Two things follow.

**Dropping `project_phase` from this repo was right**, and for a better reason
than "unused": the model belongs to the project-accounting domain, which is
Mark 85's, and duplicating it here would have created a second definition of a
thing that already has one.

**When small tools eventually needs to charge to a cost code, the shape is
already decided** — and it is not what this repo has today. STInventory has a
single free-text `project.costCenter`. The real model is a branch-level cost code
library joined to projects with an optional phase. Adopt that; do not extend the
text field.

## Divergences that will hurt if these ever merge

Not urgent, but they are decisions already made in two directions.

| | Mark 85 | STInventory |
|---|---|---|
| Scoping axis | `branch` | `tenant` — **no branch concept at all** |
| Project identity | `code`, unique per branch | `name` + nullable `externalId`, no code |
| Cost codes | Library + join table with budgets | One free-text `cost_center` on the project |
| Design system | Tamagui, shared web + mobile | Tailwind/shadcn (web) + NativeWind (mobile) |
| LLM access | Anthropic SDK direct in Hono | OpenAI-compatible HTTP, provider set per tenant |

The **branch gap** is the one worth thinking about first. Urban is multi-branch,
and this repo's own seed already has Dallas and Houston yards — but as
`warehouse` rows, with no branch above them. Small tools live in a yard, yards
belong to a branch, and a tool moving between branches is an accounting event.
Today that is unrepresentable.

The **LLM divergence** partly resolved itself: the recorded preference is
"Anthropic SDK direct in Hono, not a Python orchestrator", and this repo carried
a Python FastAPI parser until it was removed. What remains is that STInventory
speaks the OpenAI wire format to a per-tenant provider, which is a superset of
the Mark 85 approach rather than a contradiction — Anthropic can sit behind it.

## What not to do about any of this

Do not start reconciling the two schemas. Mark 85 is a prototype, STInventory is
deployed and in use, and neither has a merge date. Recording the divergences is
the work; acting on them needs a decision about whether small tools becomes a
Mark 85 module or stays a separate product, which is unresolved.
