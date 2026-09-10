# A read-only promise gets a guard, BambooHR's real lists get captured, and two skills retire

Three separate threads from the 2026-09-09 session, none of them touching the product's
own behaviour. Grouped because they all came out of the same question — *what does this
system actually know about Urban's people, and which of our own instructions are earning
their keep* — and because splitting them into three entries would leave each one too
small to be worth finding.

## What changed

### The BambooHR sync's read-only claim stops being a claim

`bamboo-sync.ts`'s header has said since it was written that `bambooGet` is the only
network call, hardcodes `GET`, takes no verb parameter, and that **"`bamboo-sync.test.ts`
asserts the method, so a future change that adds a verb fails a test rather than
shipping"**.

That test did not exist. The only Bamboo test file was `packages/domain/src/bamboohr.test.ts`,
which tests the pure adapter and makes no network calls at all. The protection was real —
the code genuinely could not write — but nothing held it there. One added parameter and the
comment would have been a lie nobody checked.

`apps/api/src/bamboo-sync.test.ts` is that test now: a source scan, no database and no
credentials so it always runs, following `tenant-predicate.test.ts`'s shape. Four
assertions — exactly one `fetch` in the file, every `method:` is `GET`, `bambooGet` takes
no method/verb parameter a caller could pass, and no other file under `apps/api` reaches
`bamboohr.com`.

It reads `method:` assignments rather than searching the text for "POST", because the file
*discusses* POST when explaining why the restraint has to live in our code (a BambooHR API
key is not itself read-only — the same credential that lists employees would accept a
write). A naive text search would fail on the documentation of the rule it enforces.

The client restated the instruction directly this session, in caps: only ever GET against
their production HR system.

### BambooHR's managed lists, captured because the API will not hand them over

`fetchBambooJobTitleOptions` asks BambooHR whether Job Title is a managed list or free
text — which decides whether mapping titles to team-role tiers is a table you fill in once
or a queue that never empties. It goes through the same audited `bambooGet`.

**It returns 403 for this tenant's key.** The key has employee read access and not field
metadata access. So the answer came from the client inspecting BambooHR's own Add Employee
form and pasting the dropdown contents in: `docs/data/bamboohr/lists.json` now holds 131
job titles, 12 departments and 6 divisions, with how they were captured and why the file
has to exist at all. The function stays — harmless if the key's access ever widens, and it
degrades to "could not check" rather than failing the sync.

### `feature-delivery` and `optix-map-evaluate` removed, `optix-intent-alignment` added

Asked for directly: too many skills, several not earning their place. Authorship was
checked in `git` rather than guessed (four were written by Utsav Subedi, five by the
repo owner) and the client chose the two to cut.

`optix-intent-alignment` replaces them: interrogate before building, 2-4 targeted
questions, wait for an answer, and keep the prose functional. It exists because
`optix-explain-before-deciding` was written on 2026-09-03 for the same complaint and did
not prevent it — its scope is decision points only, and it names explaining routine work
plainly as a *non-goal*, so most of the jargon it was meant to catch fell outside it. That
reasoning is recorded in the new skill so the next version does not repeat it.

`CLAUDE.md`'s skills table and the `optix-*` prefix note were updated in the same change,
and both removals are recorded there with what was lost — `optix-map-evaluate` was the only
thing that could build `.claude/optix-screen-map.yaml` from scratch, and `optix-map-update`
says in its own text that it cannot.

## What was found while building it, and where it went wrong first

**The word "audit" did real work here.** Every one of these threads started by checking a
claim that was already written down, and two of the three claims were false: the test that
was said to exist did not, and `.claude/rules/database.md` presents `employee.code = URB-001`
as *"the COMPANY's own identifier: Urban assigns it"* when the generator invents it at
`docs/data/build_seed_data.py:169` as `f"URB-{n:03d}"` — a spreadsheet row counter. The
source CSV has no ID column at all. That correction is **not** made here; it belongs with
the seed work and is called out in "Deliberately not done" below so it is not lost.

**A first pass at reading the job titles reported "1851 people, none with a job title",
which was a typo in the throwaway script**, not a fact about BambooHR: it read `jobTitle`
where the field is `jobTitleName`. Caught only by writing a second script that printed
which fields arrive populated — 923 of 1851 records carry a title. Worth recording because
the wrong version was briefly believed and reported, and the field-name difference is
exactly the kind of thing that reads as a data problem in the far system.

**1578 of the 1851 records carry a termination date.** Only 273 are current staff. The
sync flags terminated people rather than skipping them, so a full run would create 1578
person records for people who have left, against 273 who have not. Named here because it
is a decision waiting to be made before anyone runs the sync for real, not a bug to fix
quietly.

**Deleting a skill is not free, and `git status` is what proves it.** The first attempt
removed the two skill directories and left `CLAUDE.md` naming them, plus
`.claude/workflow.config.json` (188 lines that exist only for `feature-delivery`),
`docs/features/`, `docs/tickets/STATUS.md` and `optix-map-update`'s own text all still
pointing at them. Half of that is fixed here; the rest is listed below rather than
half-done and forgotten. A safety classifier also refused the `rm -rf` on `docs/features/`,
which was the right call — that deletion had not actually been approved.

## Verified

- `pnpm typecheck` — all 13 packages clean.
- `apps/api/src/bamboo-sync.test.ts` — 4 passing, and **each guard was confirmed to fail on
  the violation it exists for**: the verb was changed to `POST` (the GET assertion failed
  and nothing else did), and a `method` parameter was added to `bambooGet` (the parameter
  assertion failed and nothing else did). `bamboo-sync.ts` was restored with
  `git checkout` after each and confirmed byte-identical.
- `docs/data/bamboohr/lists.json` — parsed with `node`, no duplicate titles, and the
  declared count checked against the array. The first version said 129 and the array held
  131; the file now says 131 and carries a note not to hand-edit one without the other.
- The BambooHR reads themselves ran against the live production HR system, read-only:
  1851 records fetched, `meta.total` reconciled, 403 on `/meta/lists` recorded rather than
  worked around.

**Not verified:** nothing exercises `fetchBambooJobTitleOptions`' success path, because the
key cannot reach the endpoint. Its parsing is written defensively against BambooHR's
documented shape and has never seen a real payload.

## Deliberately not done

- **`.claude/rules/database.md`'s `URB-001` claim is still wrong** — it describes a
  generator-invented row counter as a company-assigned identifier. Fixing it belongs with
  the decision about what employee codes should be (BambooHR's `employeeNumber` is
  populated on 1850 of 1851 records and is the real answer), which the client has not made.
- **`.claude/workflow.config.json` and `docs/features/` are still present**, orphaned by
  `feature-delivery`'s removal, and `docs/tickets/STATUS.md` plus `optix-map-update` still
  name deleted skills. Left because the deletions were not explicitly approved.
- **No seed or sync was run for real.** The 1578 leavers question is open.

## Where it is

Committed to `development` on 2026-09-09. Not deployed — `main` is what deploys, and
nothing here has been merged toward it.
