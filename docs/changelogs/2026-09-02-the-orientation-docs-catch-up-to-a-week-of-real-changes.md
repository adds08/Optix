# The orientation docs catch up to a week of real changes

Asked directly: is this system in a "ready state," and can the docs be trusted
not to mislead the next agent. The honest answer to the first is "closer, with
a known list left" (recorded across this week's changelog entries); this entry
is the answer to the second. Six files an agent is told to read before doing
anything — `LLM_RECALL.md`, `CLAUDE.md`, `AGENTS.md`, `docs/SETUP.md`,
`docs/architecture/01-data-model.md`, `docs/CODEMAP.md` — had drifted from a
week of real work: the SaaS deploy, the two-dataset seed split, the equipment
register's VIN and class fields, and the jobsites card view. None of it was
malicious drift; each doc was accurate on the day it was written and nothing
went back to update it when the ground moved.

## What changed

**`LLM_RECALL.md`** — the file with the highest read-order precedence of any
of these. Fact 2 said "Not heavy equipment. Trucks and trailers exist only
because tools ride on them," which was true only because no form could write
`equipment_class` — it can now, and the fact is corrected in place rather than
silently swapped, with a note that it used to be wrong. A new fact records the
production reality (in-production SaaS, `main` deploys to `urban.optixtec.com`
automatically). The traps table (§6) gains the two-dataset seed entry: the
2026-09-01 mistake of replacing the test fixture with real data and turning
CI red, so the next agent hits the warning before the mistake rather than
after.

**`CLAUDE.md`** — the opening line described an internal tool; it is
rewritten to state the SaaS reality up front, since this is the file every
session loads automatically.

**`AGENTS.md`** — the largest set of corrections, roughly in order of how
badly each one could mislead:
- The seed-provenance paragraph used to say "treat `seed-data.ts` as the
  source... regenerate and merge" — literally the instruction that produces
  the CI-breaking mistake `LLM_RECALL.md` now warns about. Replaced with the
  real two-dataset split and a pointer to `docs/data/README.md`.
- Purpose statement, deployment platform (said AWS/GCP; it's DigitalOcean),
  and the CI description (said three image builds and no deploy step; it's
  two images plus `deploy-prod`/`deploy-dev`) all corrected to match
  `.github/workflows/ci.yml` and `DEPLOY.md`.
- The HR clearance queue was described twice as a live gate ("triggers a
  clearance queue," "sign-off gate... the queue itself is built"). It was
  parked 2026-08-27; nothing enforces it and no screen opens it. Both
  passages corrected, because the roadmap item read as "queue built, gate
  next" when the accurate description is "abandoned, would need
  re-verifying first."
- Vehicles described as GPS-tracked locations only; the equipment register
  now carries `equipmentClass` (vehicle/attachment/heavy/other) and `vin`.
- Notifications described the delivery layer as "still two `console.log`
  branches — there is no `nodemailer`." `packages/mail` sends real email now;
  only SMS is still a placeholder.
- The seed's production guard was described as an unconditional refusal; it
  now has a `SEED_ALLOW_PRODUCTION=1` escape hatch that also wipes the
  target database, which is worth knowing before treating it as inert.
- Smaller: the reports list stated a stale count of six slugs against a
  registry that has grown past that; the monorepo layout omitted
  `packages/mail`; the jobsites description didn't mention the Cards view.

**`docs/SETUP.md`** — the sign-in table and the seed command are marked as
describing the demo fixture specifically, with the urban dataset's single
real login named alongside it. Before this, "run `make ENV=local seed`" and
"here are the fourteen accounts" read as one universal truth rather than one
of two datasets.

**`docs/architecture/01-data-model.md`** — the vehicle section gains the
`vehicle_type` vs `equipment_class` distinction and the `vin` column, with
the same warning `.claude/rules/web.md` already carries: `vehicle_type` is
load-bearing for the composite foreign keys and must never be rewritten on an
existing row; `equipment_class` is free to change.

**`docs/CODEMAP.md`** — `docs/data/` didn't appear anywhere in the map. Added
to the repository tree and to "Finding your way to a change," pointing at the
new README below.

**`docs/data/README.md`** — new. This directory had six files and no index:
two Excel sources, three generator scripts (one stale, two current), and a
generated output directory, with the only explanation of how they relate
living in scattered code comments and a very long conversation. The README
states the pipeline in order, the exact destructive command
(`SEED_DATASET=urban SEED_RESET=1`) and what it deletes, which environments
have actually had it run against them (none — code is deployed, data is not),
the identity-collision decisions already ruled on and why, and the specific
items still open for a human (TE-027's custodian, Job 24002's real name, the
Excel import spec's missing `vin`/`equipmentClass` columns).

## What was found while building it

**The most dangerous drift was an instruction, not a fact.** A stale fact
gets a reader to a wrong conclusion; AGENTS.md's old seed section told a
reader to *do* the specific thing that already broke CI once. That is why it
is fixed first in every one of these docs and called out by name in the
traps table rather than left to be inferred from the corrected prose alone.

**A parallel four-way audit hit a spend limit three-quarters of the way
through** — one of four readers (AGENTS.md + LLM_RECALL.md) completed and
returned fourteen numbered findings with file:line evidence; the other three
(CLAUDE.md; SETUP.md/architecture/CODEMAP; docs/data + environment state)
errored before returning anything. Rather than retry the same fan-out, the
remaining ground truth was gathered with direct `grep`/`Read` — the same
"open the file, don't trust the doc" rule these docs now state applies to
verifying them, too.

## Verified

- Every corrected claim is backed by a `file:line` read in this session,
  not carried over from memory of earlier work in the same conversation —
  re-checked directly: `equipment_class`'s vocabulary and the migration that
  added it, `docs/data/import/rejects.json`'s current counts, that
  `import-specs.ts` still lacks `vin`/`equipmentClass`, that
  `NO_CUSTODIAN_TRAILERS` still contains `TE-027`, that
  `seed-data.urban.ts` exists on disk.
- Cross-referenced the successful audit pass's citations against the actual
  files before writing each correction, rather than transcribing its prose.

**Not verified:** no doc-linting or link-check tool was run; every internal
cross-reference (`docs/data/README.md`, `.claude/rules/database.md`, etc.)
was checked by hand for existence, not by an automated pass. The three failed
audit passes' intended scope (a full sweep of `docs/architecture/02-05`,
`docs/DEPLOY.md`, and every `docs/CODEMAP.md` file reference) was not
re-run in full — this entry covers what the successful pass plus direct
follow-up verified, not an exhaustive sweep of every doc in the repo.

## Deliberately not done

- **`docs/architecture/02-backend.md` through `05-features.md` were not
  audited.** The failed passes would have covered these; re-running that
  scope was judged lower value than finishing the corrections already found
  and getting back to the feature in progress. Worth a follow-up pass.
- **The stale reports list in AGENTS.md was softened, not itemized.** Per
  CLAUDE.md's own no-stale-counts rule, the fix points at the registry file
  rather than re-enumerating a slug list that will drift again.

## Where it is

Committed on `development`, alongside the ongoing jobsites card-view work in
the same session. Documentation only — no schema, no procedure, no UI change.
