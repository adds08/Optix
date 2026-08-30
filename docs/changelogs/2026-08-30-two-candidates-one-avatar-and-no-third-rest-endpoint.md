# Two candidates, one generated avatar, and no third REST endpoint

Phase 7 — the last of the seven-phase plan tracked in
`/Users/adds08/.claude-personal/plans/imperative-beaming-puzzle.md`: sidebar
org identity and admin branding. The primary rail already showed the Optix
icon-only glyph, so that half of the original ask was already satisfied.
What was actually built: two comparable placements for org identity, real
admin-editable branding fields, and a deliberate line drawn around logo
upload rather than adding a third REST endpoint at 2am to look thorough.

## What changed

### Two candidates, live at once, for a real comparison

Candidate A: a permanent block in the secondary sidebar's footer
(`apps/web/components/app-sidebar.tsx` — new `OrgIdentity`/`OrgAvatar`,
using the `SidebarFooter` primitive that already existed in `ui/sidebar.tsx`
but nothing used yet). Candidate B: the same block merged into the top-right
`UserMenu` dropdown, shown above the signed-in person's own name and role.
Both read a new `tenant` field on `identity.me` — name, slug, brandingName,
brandingLayoutMode — fetched alongside permissions the same way
`feature.states` was in Phase 5, since every signed-in person needs to know
which org they're in, not just an administrator.

No tenant switcher: `session.tenantId` is singular today, one user to one
tenant, so there is nothing yet to switch between. The identity displays now;
a switcher is a change for the day that data model actually holds a second
tenant, not before.

### Admin branding, on the existing Settings page

Two new `tenantSettings` columns (migration `0036_polite_silvermane.sql`):
`brandingName` (null falls back to `tenant.name` as-is) and
`brandingLayoutMode` (`icon_and_text | icon_only`). Exposed through the
existing `settings` router — same `PUBLIC_FIELDS`/`update` shape as the
LLM/SMTP config already there — and edited from a new "Branding" section on
`/settings`, reusing the page's existing hydrate-once/save-bar scaffolding
rather than a new screen: two fields didn't need Phase 5's whole
module-list treatment. Saving now also invalidates `identity.me`, not just
`settings.get`, since that's what both candidate placements actually read.

## What was found while building it

**Logo upload was scoped out, deliberately, mid-build.** The plan called
for reusing the asset-photo upload pattern for a tenant logo. Doing that
literally means a third REST endpoint — today's surface is documented
(`LLM_RECALL.md`) as exactly two photo endpoints plus tRPC, and adding a
third is a real architectural decision, not something to make unilaterally
while the person who'd normally be asked was asleep. No `brandingLogoKey`
column was added either, on the same reasoning `project.ts`'s own comment
gives for the deleted `project_phase` table: an unused seam is a guess that
looks like a decision, not a head start. The org avatar is a generated
initial-letter square instead — same shape as `UserMenu`'s own initials
avatar, square rather than circle so the two are never mistaken for each
other — until logo upload is a real, separately-decided feature.

## Verified

- `pnpm typecheck` clean across `@stinventory/types`, `@stinventory/db`,
  `@stinventory/api-contracts`, `@stinventory/web`.
- Full `api-contracts` suite: 257/257 passing, unchanged — nothing here
  touches a router procedure's permission logic.
- Full e2e suite: 68/68 passing.
- Wrote and ran (then deleted, not committed) a throwaway spec with real
  screenshots of both candidates visible at once — the sidebar footer in the
  background while the user-menu dropdown is open in the foreground, in the
  same frame. Confirmed the full settings-save round trip live-updates both
  placements with no reload, confirmed `icon_only` correctly collapses the
  footer to just the avatar, and reset the branding fields back to
  blank/default afterward so the seed-implied state wasn't left mutated.
- This is the first phase in the whole plan built primarily through
  screenshots rather than DOM-text assertions — the direct lesson from
  Phase 6, where a squeezed-invisible column passed every text-based check
  it was given. Every visual claim above was confirmed by looking at a
  rendered image, not inferred from a passing test name.

## Deliberately not done

- **No logo/icon upload.** See above — a real decision for the person who
  owns the REST surface, not a 2am addition.
- **No tenant switcher.** Nothing in the data model can hold a second
  tenant per user yet; building a switcher against that would be building
  against a fiction.
- **Only one candidate placement will survive.** Both are live for
  comparison; the other gets deleted in a follow-up commit once picked, not
  left as dead code.

## Where it is

Branch `development`, uncommitted at the time of writing, on top of Phases
1–6's diff in the same working tree — this closes out all seven phases of
the plan.
