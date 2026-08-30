# Seven archived documents deleted, and the six findings that were buried in one

Archiving a stale document and banner-ing it is a half measure. It leaves the
wrong content in the repository, one banner away from being obeyed, and — as this
change found — it can bury things that are still true.

## What changed

### `docs/KNOWN-ISSUES.md`, extracted before deleting its host

`STINVENTORY-EXPLAINER.md` §12 carried eight verified defects. Re-checked against
the code, four are closed and **six are still open**. Those six now live in a
document that describes the present, with the evidence for each and the reason it
matters:

1. **Rate limiting can be bypassed by rotating `X-Forwarded-For`** — no trusted
   proxy check, and it is the only rate limit in the system, guarding the only
   bcrypt endpoint.
2. **The workers cannot run in more than one instance** — no `FOR UPDATE SKIP
   LOCKED` on the message claim, no in-flight guard on the pollers.
3. **`asset.setStatus` takes `z.string()`, not the enum** — an arbitrary status
   reaches the ledger and folds back out forever. The cheapest fix on the list.
4. **Tag uniqueness is checked on update but not on create.**
5. **The login email lookup is case-sensitive** while the rate-limit key lowercases.
6. **There is no SMS channel** — the `TWILIO_*` variables are declared and read by
   nothing.

It also carries a short "deliberate, not a bug" section, because several of those
have been reported more than once.

### Two documents whose surviving content moved somewhere it will be read

- **`STINVENTORY-EXPLAINER.md` — deleted.** §1–§11 described a system since
  superseded by `docs/architecture/`; §12.2 reported an ungated `/api/*` REST
  surface that has been deleted, and was the single most expensive thing in the
  repository to act on. Its live findings are now `docs/KNOWN-ISSUES.md`.
- **`HANDOFF-tool-register-2026-07-27.md` — deleted.** Its two standing decisions
  moved into `.claude/rules/web.md`, which is the file anyone editing that page
  actually reads:
  - **filtering is client-side because of the facet counts** — each count is
    computed with its own filter lifted, so pushing status to the server makes
    every other count read zero, which is the bug the design was fixing;
  - **the High value badge is the approval gate wearing a badge** — `flags.tsx`
    and `apply-action.ts` share `DEFAULT_HIGH_VALUE_THRESHOLD`, and they must stay
    tied.

  Both were verified still true before being moved: `asset.list.useQuery()` still
  takes no arguments, `facets.tsx` is still used by `/tools` and `/jobsites`, and
  the threshold constant is still shared.

### Five deleted outright

`KILO_DELIVERY_ASSESSMENT.md`, `DELIVERY_ASSESSMENT_VERIFICATION.md`,
`DELIVERY_ASSESSMENT_RECONCILIATION.md` — three documents about one 2026-08-09
assessment whose conclusions were folded into `SYSTEM_PLAN.md` §5 weeks ago.
`16-handoff-brief.md` — orientation for an implementer picking up work that has all
shipped. `10-corpus-context.md` — covered by the parent `CLAUDE.md`.

### Four kept, and the bar written down

`03-data-model.md` (Part B is the fullest account of the design deliberately not
built), `01-plan.md` (§12 reports catalogue and §18 roadmap have no equivalent
anywhere), `04-diagrams.md` (procurement BPMN, deployment, multi-tenancy), and
`00-executive-summary.md` (written for a different reader than `SYSTEM_PLAN.md` §1).

The archive README now states the bar: **each file is here because it holds
something with no equivalent elsewhere.** An archive that keeps everything is a
place where things go to be found later by accident.

## What was found while building it

**I had nearly published a false security finding.** Re-auditing §12.4 — "project
scoping is applied in 2 of ~24 read paths" — I grepped for `visibleProjectScope`,
found three callers, and was about to write that `asset.list` still returns
tenant-wide data to any session. It does not. The scoping layer was rebuilt as the
STI-302 four-tier ladder and `asset.list` goes through `assetVisibility` /
`assetScopeWhere` — different functions in the same module. It is now applied
across `asset`, `assignment`, `dashboard`, `report`, `transaction`, `transfer`,
`project`, `projectTeam` and `location`.

The lesson is narrow and worth keeping: **when a finding names a symptom, verify
the symptom, not the mechanism the finding named.** Grepping for the old function
would have "confirmed" a hole that had been closed by renaming it.

**Deleting the archive fixed the broken-link problem rather than documenting it.**
Two changes ago the repository had broken internal links only inside
`docs/archive/`, which was explained at length as deliberate — records written at
the root and moved, not repaired because a record edited after the fact stops being
a record. That reasoning was sound and the files it applied to are now gone. The
repository has **zero broken internal markdown links**.

## Verified

- Both `HANDOFF.md` decisions confirmed still true in the code before being moved:
  `asset.list.useQuery()` called with no arguments, `facets.tsx` imported by
  `/tools` and `/jobsites`, `DEFAULT_HIGH_VALUE_THRESHOLD` shared between
  `flags.tsx` and `apply-action.ts`.
- Each of the six open findings re-checked at its cited file before being written
  down; each of the four closed ones checked too, rather than assumed from a
  changelog.
- Every deletion candidate was checked for inbound citations first. That check is
  the one skipped two days ago when `docs/features/` was deleted out from under a
  live skill.
- **Zero broken internal markdown links repo-wide**, by script.
- Every backticked path in the live entry points resolves, except the two named
  precisely because they do not exist (`apps/api/src/rest-routes.ts`,
  `packages/design-system`).

## Deliberately not done

- **Nothing was fixed.** `KNOWN-ISSUES.md` is a record, not a work item; the
  `setStatus` enum is a one-line change and was still left alone, because "while I
  was in there" is how a docs commit becomes a behaviour change nobody reviewed.
- **Changelog entries referencing the deleted files were not edited.** They are
  dated records. A link in a changelog that no longer resolves is correct — the
  file did exist when it was written.
- **`design/*/github.md` still cites `docs/16-handoff-brief.md`.** Those are
  generated artefacts in a directory this change does not own.

## Where it is

Branch `development`. `docs/KNOWN-ISSUES.md` is reachable from `LLM_RECALL.md`,
`docs/README.md`, `docs/CODEMAP.md` and `AGENTS.md`.
