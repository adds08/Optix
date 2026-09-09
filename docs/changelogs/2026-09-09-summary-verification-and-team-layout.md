# Verify the session summary and finish team layout fixes

Verified against `development` at `c919293`, following the supplied technical summary.
The tree was clean on this review's arrival; the invitation, onboarding, mapping and
project-branch work is already in `87308d7`, whose subject is only `#`. This review did
not create, amend, push or deploy those commits.

## Findings

- GitHub Actions run `34334888339` reports success for checks, images, migration/boot
  smoke tests and development deployment at `c91929319b6199f790ac9c486fe8382f7fda930f`.
  Production deployment was skipped. This verifies the workflow outcome, not a fresh
  end-to-end audit of the deployed application.
- `0058_icy_nextwave.sql` drops the team-role `is_system` column. The current router
  and UI no longer use it. This does not remove the dedicated assignment permissions.
- "Set by" is additive. `project.team.assign` or the applicable dedicated permission
  satisfies the tier-authority check even if the Set-by list is empty. The separate
  project-access and reporting-branch checks still apply. An empty list does not revoke
  permissions already granted to an account.
- Required onboarding redirects are implemented in the web shell. `protectedProcedure`
  authenticates the session; it does not impose a universal onboarding-completion gate
  on every API operation. Initial claiming separately checks its lifecycle server-side.
- The earlier type-check report covered the apps, not every package test file. The
  tuple-cast correction in `1e699ac` addresses the missed package-test typing error.
- A fresh review run against the separate `stinventory_onboarding_test` database passes
  **642 tests in 49 files**. Failures caused by running demo-fixture tests against a
  modified operational database are a different result; do not reset operational data
  to make that fixture pass.

## Changes in this review

- Set-by trigger: constrain and truncate long summaries, retain full text in a title,
  and keep the chevron from shrinking. Bound the checklist to the viewport and give
  long option labels wrapping and the panel vertical scrolling.
- Project Teams: stack action buttons beneath the person's details on small screens.
  The prior flex row technically fit 390px but squeezed names into narrow word stacks.
  Desktop rows retain their side-by-side layout.

## Validation and status

- Current API-contract package and web TypeScript checks pass.
- ESLint passes for both edited components; `git diff --check` passes.
- Real Chromium sign-in using the isolated local presentation tenant: project-team
  page has no horizontal overflow at 390px; screenshots visually inspected. A long
  Set-by selection renders inside the 208px trigger with ellipsis. Its actual checkboxes
  were exercised in the presentation tenant and restored to their prior empty state.
  No browser page errors occurred.
- No BambooHR requests, production changes, database resets, commits or pushes in this
  review. These layout changes are local and uncommitted; the previously verified dev
  deployment does not yet include them.
