# The jobsite board learns two levels, and superintendents can hold tools

Six changes to Tools by Jobsite, from one session of watching somebody use it. They are
grouped here because four of them turned out to share a cause: the board models a job as
two levels — the job, and the crews inside it — and several controls were built as though
it were one.

The dropdown sweep that was requested alongside these is deliberately not here. It touches
around twenty files unrelated to this screen, and a mechanical UI diff that large is not a
good place to hide a custody-model change.

## What changed

### The master expand button steps through four clicks, and can no longer be overruled

Two faults, one control. It could not *win*: per-card state lived in `openJobs`, read as
`collapseAll ? (openJobs[id] ?? false) : (openJobs[id] ?? true)` — a default, not an
override — so opening a single job by hand made that card ignore "Collapse all" for the
rest of the session. Each master click now clears both per-item maps, so it always applies
to everything and manual toggles resume from there.

And it could not reach the state people wanted, because one boolean cannot say "open the
jobs but leave the crews shut". The button now steps: jobs open with crews shut, then
crews open, then crews shut again, then everything shut. The third step repeats the first
state on purpose — coming back from "all crews open" should land on the overview, not skip
past it to a collapsed list. Four clicks, three states, and the button's label always names
what the next click does.

### The Equipment Yard returns to the Jobs tab, pinned last

It was excluded from Jobs on the reasoning that it is not a job. True, and the wrong
conclusion: the yard is where the tools *not* on a job are, which is exactly what somebody
scanning the Jobs tab is trying to find out. They had to know the Pool tab existed and go
looking.

Pinned below every job rather than sorted with them. Sorting it in was the original mistake
— the yard holds more tools than any single site by definition, so "most tools" put the
warehouse at the top of a board about job sites.

### A crew with no truck and no trailer can be put on a job

The picker refused anybody holding neither, on the reasoning that "those are what move to a
job". They are what *carries tools* to a job, which is a different claim. A crew is put on a
job before it is rigged all the time: the job is awarded, the foreman is named, and the
truck is allocated the following week. Refusing meant the roster could not describe the
fortnight in between, so the desk recorded it nowhere and the job read as having no crew at
all. The gap is still worth saying — the row still shows "no truck or trailer yet" — it is
just not worth blocking.

### Moving a crew asks whether the tools come too

Ticked by default, which is both the old unconditional behaviour and the right answer nearly
always: tools follow the person, not the site.

Unticked is the new part, and it is not "do nothing". Left alone, the tools would keep the
departing person as custodian while they work somewhere else, so the register would name a
holder who is not there — the STI-306 failure arriving through a different door. So it
*releases* them: custodian cleared, project and location kept, which lands them in the
"nobody holding" state the job cards already draw. Through `custody.ts` and with a complete
ledger snapshot, truck and trailer stamped as affirmative nulls because the rig leaves with
its owner.

### Superintendents can hold custody, and have their own glyph

`CUSTODIAN_ROLES` was `foreman` and `mechanic`. A job is routinely awarded and rigged before
its foreman is hired, and the superintendent running the crews is who physically holds the
small tools, the truck and the trailer until then. Excluding them never stopped that
happening — it stopped it being recorded, so the register showed a rigged job with nobody
holding anything.

Their project link now moves custody the way a foreman's does, and the crew picker posts
them under their own team role instead of filing everybody as a foreman. On the board they
get `ClipboardCheck` rather than sharing `ShieldCheck` with the equipment admin — they now
appear as crew rows directly above and below foremen, and the row has to say at a glance
which of the two is holding the tools. The white hat stays: that map models real hard-hat
colour, where white *is* supervision.

### Roster rows record which system wrote them

A `source` column on `tbl_ops_project_team_member`, defaulting to `equipment_department`.
Purely descriptive — nothing branches on it and nothing should. Urban's crews are keyed
differently in the equipment department, in payroll, and in whatever comes next, so when two
of them disagree about who is on a job the reconciliation needs to know which one wrote the
row. That is unanswerable after the fact, which is why the column exists before there is a
second writer.

### "Where it goes" keeps its field and loses its ambiguity

This one was reported as a duplicate of the truck and trailer pickers and a request to
delete it outright. It is not a duplicate: vehicles were filtered out of it by STI-203, so
what it offers is gang boxes, containers and yards. The label read "Where it goes" over a
list of *Gang Box A — Miguel Torres*, which is what made it look like the rig.

The rig is how a tool **travels**; this is where it **lives** once it arrives, and nothing
else records the second. Both are now said in the words a yard uses, and the field became
searchable in passing.

## What was found while building it

**The comments claimed a test that did not exist.** `CUSTODIAN_ROLES` in `packages/types`
and `canHoldCustody` in `packages/db` are two statements of one fact in two packages, and
both files said the RBAC matrix test enforced the agreement. Nothing did. Adding
`superintendent` to one and forgetting the other would have offered a custodian the database
refuses — which is the same class of drift that caused `CUSTODIAN_ROLES` to be created in
the first place, after three custodian pickers had gone their own ways. The claim is now
true rather than softened.

**The relationship is deliberately asymmetric.** `canHoldCustody` is the wider set: `crew`
carries it, because most of a yard holds tools and never signs in, and is deliberately
absent from `CUSTODIAN_ROLES`, which is the list a picker offers. That asymmetry is now
pinned too, so a future tidy-up does not "fix" it by putting non-login labourers into every
custodian dropdown in the product.

**`moveEmployeeToProject` already had a `moveTools` flag**, but it means "the tools are
already right, do not touch them" — a correction. The new case is a different sentence with
the same first word, so it is a second, explicitly documented argument rather than a
reinterpretation of the existing one. Existing callers are untouched.

**The yard is still matched by project name.** `isYardProject` compares the name string, and
the comment on it already flagged that a rename walks straight past it. Now that the card
appears in both tabs and carries a pinning rule, that weak spot is load-bearing in one more
place. Still not fixed here — the durable answer is a column on `project` — but it is worth
knowing before somebody renames a project.

## Verified

`pnpm typecheck` clean across the workspace. `turbo run test` green in every package, run
inside the api container so the database-backed suites executed rather than skipping —
`@stinventory/api-contracts` went from 262 tests to 270.

The new drift test was confirmed to fail on the drift it guards: flipping `superintendent`
back to `canHoldCustody: false` produces *"superintendent is offered as a custodian but
roleSpecs says it cannot hold custody"*, and passes again when restored.

The crew-move suite asserts what was written, not what was skipped: that the default move
carries the tools and keeps the holder, that unticking clears the custodian while leaving
the project, closes the custody link rather than orphaning it, and drops `assigned` to
`available`; that the ledger snapshot carries every key including affirmative null truck and
trailer; that a superintendent's tools move too; and that provenance is stamped and defaults.

Migration 0039 applied locally, then the database was reseeded from scratch with
`SEED_RESET=1` and checked directly: the superintendent role carries `can_hold_custody`,
SUP-001 holds two tools with two matching open custody links, no ledger row has a null
`to_state`, and every roster row carries a source.

**Not verified:** nobody has driven the screen in a browser. The expand/collapse cycle, the
pinned yard card, the confirm-dialog checkbox and the new glyph are all argued from the code
and typecheck, not observed. This is the part most worth a look before merging.

## Deliberately not done

**The dropdown sweep**, which is the follow-up PR. Only the one field touched by the "Where
it goes" fix was converted here.

**The yard's name matching was left alone.** Replacing it with a column on `project` is the
right fix and is its own change.

**No other role gained `canHoldCustody`**, and no other role's grants were reconciled. The
Roles screen exists so Urban can disagree with `role-perms.ts`, and a blanket pass would
overwrite decisions somebody made on purpose.

**`TOOLS_FOLLOW` still excludes `pm`.** A project manager's link is a roster entry and moves
nothing, which is unchanged and correct.

## Where it is

Branch `feat/jobsites-crew-controls`, off `main` at `5673354`.

**Not deployed.** Production runs `5673354`, which carries yesterday's permissions fix and
none of this.
