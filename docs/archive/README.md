# Archive

Documents kept for the record. Nothing here is current. If one disagrees with the
code, the code wins; if it disagrees with [`../architecture/`](../architecture/),
the architecture documents win.

**Four files, and each is here because it holds something with no equivalent
elsewhere.** That is now the bar. On 2026-08-29 seven files were deleted from this
directory — status reports about moments that had passed, and orientation documents
whose readers had all finished. An archive that keeps everything is a place where
things go to be found later by accident.

| File | Why it survives |
|---|---|
| `03-data-model.md` | Its **Part B** is the fullest written account of the design deliberately *not* built. Part A is superseded — every table it names was renamed on 2026-08-28, so **do not use it as a schema reference**; that is [`../architecture/01-data-model.md`](../architecture/01-data-model.md) |
| `01-plan.md` | The former master functional spec. **§12 (the reports catalogue — reports are the moat) and §18 (the long roadmap) have no equivalent anywhere else yet.** Mine those; ignore the rest |
| `04-diagrams.md` | Holds the procurement BPMN, deployment, multi-tenancy and event-fold diagrams. `SYSTEM_PLAN.md` carries only the ones the current build needs |
| `00-executive-summary.md` | The leadership pitch. `SYSTEM_PLAN.md` §1 makes the same case for a build audience; this one is written for a different reader |

## Two warnings

**Relative links inside these files are broken**, and deliberately not repaired.
Several were written at the repository root and moved here, so their `packages/...`
and `apps/...` links no longer resolve — the paths they name are still correct
relative to the repository root. **A record edited after the fact stops being a
record**, so they stand as written.

**Table names throughout predate the 2026-08-28 rename.** Where these say `asset`,
`assignment` or `transaction`, the physical tables are `tbl_entity_asset`,
`tbl_ops_smalltools_custody` and `tbl_ops_transaction`.

## What was removed on 2026-08-29, and where it went

Kept as a note because "where did that file go" is a question somebody will ask,
and because two of them held things worth rescuing.

| Deleted | Why, and what survived it |
|---|---|
| `STINVENTORY-EXPLAINER.md` | The 2026-08-15 walkthrough. §1–§11 were superseded by `../architecture/`; §12.2 reported an ungated `/api/*` REST surface that has been **deleted**, and would have sent readers hunting for it. **Its six still-open findings were re-verified and moved to [`../KNOWN-ISSUES.md`](../KNOWN-ISSUES.md)** |
| `HANDOFF-tool-register-2026-07-27.md` | Tool Register handover. The register has been rebuilt several times since and one of the four files in its "complete list" no longer exists. **Its two standing decisions — client-side facet filtering, and the High value badge being the approval gate — moved to `.claude/rules/web.md`**, which is the file people editing that page actually read |
| `KILO_DELIVERY_ASSESSMENT.md` | The 2026-08-09 file-level assessment. Conclusions folded into `SYSTEM_PLAN.md` §5 |
| `DELIVERY_ASSESSMENT_VERIFICATION.md` | Re-check of that assessment's citations. Corrections were applied |
| `DELIVERY_ASSESSMENT_RECONCILIATION.md` | Settled where the two disagreed. Settled |
| `16-handoff-brief.md` | Orientation for an implementer picking up docs 11–14 and 17. All of that shipped, so the brief had no reader left |
| `10-corpus-context.md` | How this repo relates to the rest of Urban's stack. The parent `CLAUDE.md` covers the same ground |

Three separate documents about one assessment was the problem, not the assessments
themselves. A status report has a shelf life measured in weeks; keeping several of
them alongside live specs made it unclear which described the system and which
described a moment. The answer turned out to be deleting them once the conclusions
had landed somewhere permanent, not filing them more neatly.
