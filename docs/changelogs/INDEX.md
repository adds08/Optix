# Changelog index

Every entry in `docs/changelogs/`, newest first. **Generated from the files**, not
written from memory — an index that disagrees with the directory is worse than no
index.

`docs/changelogs/README.md` is the authority on the format and on how entries
relate to specs and the sprint plan. This file is only a way in.

## How to use it

The changelog is the cheapest orientation this repo has. Git records what bytes
changed; these record *why*, what was verified, and what was deliberately left
undone — which is the part that survives a compacted context and a `--continue`.

```bash
grep -rln "custody.ts\|data-table" docs/changelogs/   # everything that touched a file
ls docs/changelogs/ | tail -20                         # what landed most recently
```

When picking up unfamiliar work, read the entries that name the file you are about
to edit before reading the file. Several of them record a decision that the code
alone cannot explain.

## 2026-08

| Date | Entry |
|---|---|
| 2026-08-30 | [A foreman shows up before holding a tool, and a picker says which one](2026-08-30-a-foreman-shows-up-before-holding-a-tool.md) |
| 2026-08-30 | [A blob becomes a line, and a pin stays in its lane](2026-08-30-a-blob-becomes-a-line-and-a-pin-stays-in-its-lane.md) |
| 2026-08-30 | [Two candidates, one generated avatar, and no third REST endpoint](2026-08-30-two-candidates-one-avatar-and-no-third-rest-endpoint.md) |
| 2026-08-30 | [A header that says something, and a Name column that was never really there](2026-08-30-a-header-that-says-something-and-a-name-column-that-was-never-there.md) |
| 2026-08-30 | [A fourth state nobody had to build twice](2026-08-30-a-fourth-state-nobody-had-to-build-twice.md) |
| 2026-08-30 | [A second door for import, and a checkbox on every register](2026-08-30-a-second-door-for-import-and-a-checkbox-everywhere.md) |
| 2026-08-30 | [One sort control, a pager that actually sticks, and a header that can't yet](2026-08-30-one-sort-control-a-pager-that-sticks-and-a-header-that-cant-yet.md) |
| 2026-08-30 | [A code leads every register now, and "job" stops meaning "project"](2026-08-30-a-code-leads-every-register-now.md) |
| 2026-08-29 | [A job costs nothing and must start somewhere](2026-08-29-a-job-costs-nothing-and-must-start-somewhere.md) |
| 2026-08-29 | [The docs describe the system again, and v1.0.0 gets a name](2026-08-29-the-docs-describe-the-system-again.md) |
| 2026-08-29 | [One front door for agents, and five that were competing for the job](2026-08-29-one-front-door-for-agents.md) |
| 2026-08-29 | [Icon size is its own knob, and the mobile question gets a measured answer](2026-08-29-icon-size-is-its-own-knob.md) |
| 2026-08-29 | [Freezing on both axes, and a row menu that answers two questions](2026-08-29-freezing-on-both-axes.md) |
| 2026-08-29 | [Seven archived documents deleted, and the six findings that were buried in one](2026-08-29-delete-the-archive-keep-the-findings.md) |
| 2026-08-28 | [A tool says who is accountable for it, and the dead-code check stops lying](2026-08-28-tools-name-their-chain-and-a-false-green.md) |
| 2026-08-28 | [The register stops cutting data off](2026-08-28-the-register-stops-cutting-data-off.md) |
| 2026-08-28 | [The deploy did not fail — two tests I wrote did](2026-08-28-the-deploy-did-not-fail.md) |
| 2026-08-28 | [Tables that read like a spreadsheet](2026-08-28-tables-that-read-like-a-spreadsheet.md) |
| 2026-08-28 | [Every table says which half of the business it belongs to](2026-08-28-table-naming-convention.md) |
| 2026-08-28 | [Columns resize, and the table scrolls](2026-08-28-resizable-columns.md) |
| 2026-08-28 | [A pin moves a row, and the app opens on it](2026-08-28-pins-move-rather-than-copy.md) |
| 2026-08-28 | [There is one register of people now, and a role that means one thing](2026-08-28-one-register-of-people-and-a-role-that-means-something.md) |
| 2026-08-28 | [Ticking a checkbox stops moving the page](2026-08-28-nothing-moves-when-you-tick-a-checkbox.md) |
| 2026-08-28 | [The header band stops short, and the Equipment Yard leaves the Jobs tab](2026-08-28-header-notch-and-the-yard-is-not-a-job.md) |
| 2026-08-27 | [The menu stops calling small tools "Equipment", and the schema learns the difference](2026-08-27-registry-equipment-and-the-entity-shelf.md) |
| 2026-08-27 | [Optix takes the interface, and the shell stops flinching](2026-08-27-optix-pins-and-a-shell-that-stops-jumping.md) |
| 2026-08-27 | [The API stops answering every origin, and a cleanup ticket turns out to be about one laptop](2026-08-27-cors-allow-list-and-cruft-that-was-never-committed.md) |
| 2026-08-26 | [Lint goes to zero, and one warning it was hiding](2026-08-26-lint-clean-and-a-missing-warning.md) |
| 2026-08-25 | [Row actions move behind one menu](2026-08-25-row-actions-behind-one-menu.md) |
| 2026-08-25 | [Only an UNAUTHORIZED signs you out](2026-08-25-only-unauthorized-signs-you-out.md) |
| 2026-08-25 | [One trigger for every row menu](2026-08-25-one-action-menu-trigger.md) |
| 2026-08-25 | [A new session starts with an empty query cache](2026-08-25-login-loop-cached-error.md) |
| 2026-08-25 | [CI seeds before it tests, and one retry policy for every query](2026-08-25-ci-seeds-before-testing.md) |
| 2026-08-24 | [The rail describes modules, and Settings stops being an entity](2026-08-24-shell-modules-and-settings.md) |
| 2026-08-24 | [The reachability suite reads one sidebar and calls it the navigation](2026-08-24-reachability-walks-the-rail.md) |
| 2026-08-24 | [The reachability walk was right and unaffordable](2026-08-24-reachability-cost.md) |
| 2026-08-24 | [The branch could not build, and the menu had no rule for what comes next](2026-08-24-production-check-and-the-shape-of-the-menu.md) |
| 2026-08-24 | [Two branches generated a `0022`, and the merge lost both](2026-08-24-migration-0022-collision.md) |
| 2026-08-24 | [Accounts get invited by email now, and email actually sends](2026-08-24-invites-and-real-email.md) |
| 2026-08-09 | [Rentals and loans are gone, and only the desk moves tools](2026-08-09-rentals-and-loans-removed.md) |
| 2026-08-09 | [Error boundaries, the desk gets told, and three packages that were never imported](2026-08-09-error-boundaries-desk-alerts-dead-packages.md) |
| 2026-08-09 | [The dashboard stopped reporting money](2026-08-09-dashboard-drops-the-money-tiles.md) |
| 2026-08-07 | [The app shell became a viewport frame, and the dropdowns stopped truncating](2026-08-07-app-shell-viewport-frame.md) |
| 2026-08-02 | [Dashboard restructured 60/40 with the fleet map, and the map renamed](2026-08-02-dashboard-map-layout-and-rename.md) |
| 2026-08-02 | [Dashboard redesign, chat two-pane, auth panel, reports consolidation, motion, dev tunnel](2026-08-02-dashboard-chat-auth-redesign.md) |
| 2026-08-02 | [Command center and modernization: DataTable, top nav, intelligent inbox, dashboard + themes, mobile motion](2026-08-02-command-center-modernization.md) |
| 2026-08-02 | [The login panel became a custody route, and the rail's collapse moved to the header](2026-08-02-auth-panel-custody-route.md) |
| 2026-08-01 | [Vehicle GPS tracking: online/offline status, the fleet map, and the "No tracker" nuance](2026-08-01-vehicle-gps-tracking-map.md) |
| 2026-08-01 | [Docs 11, 12, 13, 14, 17 implemented: departments, model split, Excel round-trip, dashboard, optional tags](2026-08-01-phases-11-17-implemented.md) |
| 2026-08-01 | [Import headers match by meaning; specs written and audited](2026-08-01-import-headers-and-specs.md) |

## 2026-07

| Date | Entry |
|---|---|
| 2026-07-31 | [Engine sidecar removed, scratch files stopped shipping, healthcheck fixed](2026-07-31-server-cleanup-and-healthcheck.md) |
| 2026-07-31 | [Foreman hand-offs become borrows the desk verifies](2026-07-31-foreman-handoffs-become-borrows.md) |

