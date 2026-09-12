# A jobsite explorer keeps the selected job and its tools together

The new Jobsite Explorer gives the equipment desk a focused way to browse one job at a time. Jobs are searchable in a left-hand list; the selected job shows its tool records, custodians, statuses and categories in one filterable view.

## What changed

Added `/jobsites/explorer` with scoped project and asset data, job search, custodian tabs, tool search, status/category filters, empty and loading states, and links to existing tool detail pages. The current `/jobsites` screen remains unchanged.

## Verified

`pnpm --filter @stinventory/web typecheck` passes. The local API and Docker services were not running, so browser interaction against live data was not available in this session.

## Deliberately not done

This first version does not add custody mutations, team editing, or a new navigation item. Those actions remain on their existing screens.

## Where it is

Implemented locally on the current branch; not deployed.
