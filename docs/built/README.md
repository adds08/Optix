# Built

Specs for features that have shipped. They are kept because they explain *why* a feature
works the way it does, which the code cannot tell you. They are not a work queue, and
nothing here is outstanding.

If one of these disagrees with the code, the code is right and the file is stale — check
`../changelogs/` for what actually landed.

| File | Feature |
|---|---|
| `11-department-cost-targets.md` | Charging a tool to a department instead of a project, and the `mechanic` role |
| `12-model-field-split.md` | Splitting `asset.modelName` into make / model number / description |
| `13-excel-round-trip.md` | Importing and exporting the trailer sheets Urban already keeps |
| `14-dashboard-additions.md` | The four things the desk dashboard could not previously answer |
| `17-optional-tags.md` | A tag is a physical label, not an assigned id; tools can exist untagged |
| `18-vehicle-tracking-and-map.md` | Online/offline from GPS freshness, the fleet map, and the personal-allowance "no tracker" nuance |
| `19-command-center-and-modernization.md` | DataTable + filter sheet, notification centre, intelligent inbox, dashboard widgets, theme engine |
| `20-dashboard-chat-auth-redesign.md` | Global search, collapsible rail, dashboard tabs, reports consolidation, chat two-pane, auth redesign |

Note for the dashboard epic (STI-900s): `20-dashboard-chat-auth-redesign.md` already
describes a dashboard-tabs implementation. Read it before building custom tabs — the story
extends that work rather than starting from nothing.
