# Archive

Documents kept for the record, not for reading before you build. Nothing here is current.
If one of these disagrees with `docs/workings/SYSTEM_PLAN.md`, the system plan wins.

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

Three separate documents about one assessment was the problem, not the assessments
themselves. A status report has a shelf life measured in weeks; keeping several of them
in `docs/` alongside live specs made it unclear which described the system and which
described a moment.
