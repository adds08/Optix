# Job groups were never dead — the page was, and it is gone

The first run of the `optix-map-evaluate` skill flagged `/job-groups` as reachable only by
typing the URL: no `nav-config.ts` entry, no link from anywhere in the shell, and zero rows
in `tbl_entity_project_group`. It was recorded as undecided — an accidental drop from a past
nav refactor, or a retirement nobody finished — and the two docs asserting it was an ordinary
route were corrected to say so.

That was the right thing to record and the wrong conclusion. The user pushed back with a
screenshot of the sidebar scope selector and a description of what job groups are actually
for: a PM on sixteen jobs groups two or three of them, or drills to one, and the whole
product scopes to that set. The question they asked was the right one — is this route related
to that, and if not, is it needed?

It is related. It is also not needed.

## What changed

### `/job-groups` deleted

`components/project-switcher.tsx` — mounted in `app-sidebar.tsx`, so present on every
route — is the feature. It lists JOBS and JOB GROUPS, drills into a group's jobs, and offers
"Create new group". `components/job-group-modal.tsx` handles create and edit: name,
description, member jobs (`projectGroup.setProjects`), and the users who can see the group
(`projectGroup.setUsers`).

Compared feature by feature, the page was a strictly weaker duplicate: same modal, same job
list, and **no way to assign users at all** — the half that makes group scoping do anything.
The only thing it had that the switcher does not is an immediate-write checkbox per job
rather than the modal's batched save, which is a UX difference, not a capability.

Deleting it orphans no procedure. Every `projectGroup.*` call the page made is also made by
the switcher (`list`), `job-scope.tsx` (`mine`) or the modal (`create`, `update`, `delete`,
`setProjects`, `setUsers`, `userOptions`) — checked before deleting, because
`reachability.test.ts` would have failed otherwise and it would have failed for a good
reason.

### Three docs corrected, and the map's own record of the episode

`docs/architecture/05-features.md`, `docs/architecture/03-frontend.md` and
`.claude/rules/web.md` all listed `/job-groups` as an ordinary Organization route. All three
now describe the switcher as the surface and carry an explicit "do not re-add a standalone
job-groups screen". `03-frontend.md`'s route table was separately stale in two other ways —
missing `/equipment` + `/equipment/[id]` under Registry, and missing `/settings/modules` and
`/settings/team-roles` under Admin — fixed in the same pass.

`.claude/optix-screen-map.yaml` drops the entry and records the correction in `_meta.notes`
rather than silently showing 32 routes where it once showed 33. A map that quietly changes
its own count teaches nobody anything; one that says "this is what I concluded, and here is
what I concluded before" is worth re-reading.

## What was found while building it

**A mutation shipped without a permission entry and the RBAC test caught it.**
`projectTeam.setReportsTo`, added earlier the same day, uses an in-body `assertCanAssign`
rather than `requirePermission` — correctly, because which permission applies depends on the
ROLE OF THE ROW BEING EDITED, which is not in the input and cannot be known until the call
arrives. That is exactly the case `BARE_BY_DESIGN`'s category (a) exists for, and the entry
was simply missed when the procedure was written. `rbac-matrix.test.ts` failed on the next
full run and named it precisely.

**The map's own YAML had to be validated, not trusted.** Writing 900 lines of YAML by hand
produced several genuine parse errors — list items whose text contained an unquoted
`word: value` shape, and quoted phrases that closed mid-line leaving trailing text outside
the quotes. None of them were visible by reading; all of them were caught by actually parsing
the file, diffing its route keys against `find`, and asserting every cited path exists. A map
that does not parse is worse than no map, and "it looks right" is not the same as "it loads".

**A date was fabricated in a code comment, caught before commit.** A `PageHeader` comment
claimed "Added 2026-09-04"; `date` on the machine said 2026-09-03. Noted in the previous
entry too, and repeated here because it is a habit worth breaking rather than a one-off: a
date in a comment is a factual claim.

## Verified

- `pnpm typecheck` across the workspace: 13 of 13 tasks pass.
- `packages/api-contracts` vitest: 27 files, 279 tests pass — including
  `reachability.test.ts` (which proves the deletion orphaned nothing) and
  `rbac-matrix.test.ts` (which failed first, for the reason above, and was fixed rather than
  suppressed).
- `packages/domain` vitest: 44 tests pass.
- `.claude/optix-screen-map.yaml` parses as YAML; its 32 route keys diff clean against
  `find apps/web/app/(app) -name page.tsx`; every `file:` and every cited doc path exists on
  disk; every `memory:` citation resolves to a real memory file.

**Not verified.** Nothing in this entry was clicked in a browser. The Playwright MCP was not
reachable in this session — a subagent confirmed it and stopped rather than inventing a
result — so the org-chart canvas fixes and the header changes from earlier today still rest
on the user's own screenshots plus typecheck, and the `/job-groups` deletion rests on a
static read of what links to it.

## Deliberately not done

- The switcher was NOT extended with the deleted page's immediate-write checkbox. The modal's
  batched save is a different trade-off, not a worse one, and changing it was not asked for.
- `tbl_entity_project_group` is still empty. Seeding a demo group would exercise the scoping
  path end to end and nothing currently does — worth a ticket, not a silent addition here.

## Where it is

Branch `feature/org-chart`, merged to `development` and pushed in the same session. Not on
`main`, so not deployed to production — `development` deploys to the dev/showcase
environment only.
