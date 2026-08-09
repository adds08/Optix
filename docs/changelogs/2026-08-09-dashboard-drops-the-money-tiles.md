# The dashboard stopped reporting money

Three finance figures came off the desk dashboard. None of them is deleted —
all three are still reports.

## What changed

- **"Fleet value" is gone from the metrics row.** It was one sum of every
  acquisition cost in the tenant. Nobody issues a tool, chases an overdue one
  or writes one off because of what the register totals, so it was occupying a
  tile on a screen the yard reads every morning to answer operational
  questions.
- **"Capital in the shop" is gone from the metrics row.** Same reasoning, and
  it was the more confusing of the two: the total acquisition cost of tools
  charged to a department rather than a job is a question finance asks once a
  quarter, phrased in a way that does not survive being read at a desk.
- **The "Capital split" widget is off the Command Center.** It is the same
  project-versus-department number as a pie.
- **`dashboard.kpis` no longer computes `fleetValue`.** It was a full-table sum
  running on every dashboard load for a figure nothing rendered.

**"Capital on jobs" was kept.** "What is this job holding" is a question the
desk does ask — it comes up whenever a project closes out and somebody has to
work out what has to come back. It is the one of the three that is operational
rather than financial.

## What was deliberately not deleted

Every report survives, which is the point:

- `/reports/capital-by-project`
- `/reports/capital-by-department`
- `/reports/charts/capital-split`

`CapitalSplitWidget` is still exported from `dashboard-widgets.tsx` because the
chart report renders it — the widget registry and the report registry are
separate lists over the same component, so taking it off the dashboard did not
touch the report. Reports are where a financial question gets answered; the
dashboard is where an operational one does. Nothing was lost, it moved to the
surface that suits it.

## Found while doing it

**`widgetVisibility` needed no migration.** It iterates `WIDGET_DEFS` and only
copies stored keys it still recognises, so a saved preference carrying
`capital: true` is ignored rather than crashing or resurrecting the widget.
That was already the right shape; it just had not been exercised until a widget
was removed.

**`apps/api/src/rest-routes.ts` still computes its own `fleetValue`.** Left
alone deliberately — it is the duplicate REST surface that AGENTS.md already
lists as known issue #2, where the tRPC routers win. Changing it here would
have been scope creep into a surface that is on its way out.

## Where it is

Working tree only, on `chore/assessment-cleanup-and-desk-alerts`. `pnpm
typecheck` 12/12 and `pnpm test` 139/139 pass; lint is unchanged at 9
pre-existing warnings. Live on the local docker stack.
