# Archive

Documents kept for the record, not for reading before you build. Nothing here is current.
If one of these disagrees with the code, the code wins; if it disagrees with
[`../architecture/`](../architecture/), the architecture documents win.

**Two warnings that apply to everything in this directory.**

Several of these files describe code that has since been deleted — most sharply
`STINVENTORY-EXPLAINER.md`, whose §12.2 reports an ungated `/api/*` REST surface that
no longer exists. **An agent acting on an archived finding will go hunting for code
that is not there.** Each file carries a banner saying what in it has gone stale;
read the banner before the file.

Relative links inside these documents are broken by design rather than by neglect —
several were written at the repository root and moved here, so their `packages/...`
and `apps/...` links no longer resolve. The paths they name are still correct
relative to the repository root. They are not repaired because **a record edited
after the fact stops being a record.**

| File | Why it is here |
|---|---|
| `KILO_DELIVERY_ASSESSMENT.md` | The 2026-08-09 file-level assessment. Its conclusions were folded into `SYSTEM_PLAN.md` §5, which is now the single statement of where the build stands |
| `DELIVERY_ASSESSMENT_VERIFICATION.md` | Re-check of every citation in that assessment. The corrections it lists were applied |
| `DELIVERY_ASSESSMENT_RECONCILIATION.md` | Settles where the assessment and its verification disagreed. Settled; the numbers live in `SYSTEM_PLAN.md` §5 |
| `16-handoff-brief.md` | Orientation for an implementer picking up docs 11–14 and 17. All of that work shipped, so the brief has no reader left. `AGENTS.md` covers orientation now |
| `00-executive-summary.md` | The leadership pitch. `SYSTEM_PLAN.md` §1 makes the same case for a build audience |
| `01-plan.md` | The former master functional spec. `SYSTEM_PLAN.md` replaced it. **Still worth mining:** §12 (the reports catalogue — reports are the moat) and §18 (the long roadmap) have no equivalent elsewhere yet |
| `04-diagrams.md` | Mermaid diagram set. `SYSTEM_PLAN.md` carries the ones the current build needs (ERD, custody state machine, architecture, org hierarchy); this file also holds procurement BPMN, deployment, multi-tenancy and the event fold |
| `10-corpus-context.md` | How this repo relates to the rest of Urban's stack. The parent `CLAUDE.md` covers the same ground |
| `03-data-model.md` | The former schema document. Every table it names was renamed on 2026-08-28, so it cannot be used as a reference; superseded by `../architecture/01-data-model.md`. Kept because its Part B is still the best account of the design deliberately not built |
| `STINVENTORY-EXPLAINER.md` | The 2026-08-15 verified walkthrough, against commit `72cbcdc`. Accurate when written. **Its §12.2 and architecture diagram describe a REST surface that has been deleted** |
| `HANDOFF-tool-register-2026-07-27.md` | Handover for the Tool Register redesign. The register has been rebuilt several times since; the two design decisions it records still explain the shape |

Three separate documents about one assessment was the problem, not the assessments
themselves. A status report has a shelf life measured in weeks; keeping several of them
in `docs/` alongside live specs made it unclear which described the system and which
described a moment.
