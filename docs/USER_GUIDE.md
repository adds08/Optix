# Optix — user guide

For the people who run Optix day to day: the equipment desk, administrators,
project managers and superintendents. It covers the parts that are easy to get
wrong rather than every button on every screen.

Written 2026-09-08. If a screen disagrees with this guide, the screen is right
and this needs fixing.

---

## 1. The one idea that explains everything

**Where a tool is, is calculated — never typed in.**

Every hand-over, transfer, repair and return is written to an append-only
ledger. The register's "who holds this" column is a *summary* of that ledger,
not the source. This is why:

- you can always answer "who had this tool in March", and
- correcting a mistake means recording the correction, not editing history.

Ownership (who paid) and custody (who is holding it) are separate. **Tools
follow the person, not the site** — move a foreman to another job and their
tools, truck and trailer go with them.

---

## 2. Three different things are called "role". This trips everybody up.

| What you see | What it actually is | Where you change it |
|---|---|---|
| **Job Title** on `/people` | What HR calls them — "Curb Man", "Carpenter II". Comes from BambooHR. | In BambooHR, then sync |
| **Role** on `/people` | Their **login** role — what they may do in Optix | `/admin/roles`, or when you invite them |
| **Team Roles** in Settings | Their **position on a job** — who answers to whom | `/settings/team-roles` |

They are deliberately independent. Somebody can be a *Carpenter II* by job
title, hold the *crew* login role (so never signs in), and sit on a job as a
*Foreman*. All three at once, all correct.

**If the Role column is blank**, that person has no login role yet. That is
normal for most of the yard — see §4.

---

## 3. People

### The register

`/people` lists everyone. The columns worth knowing:

- **Employee Code** — the badge number. Urban's own, stable across systems.
- **Role** — login role (see above). Blank means none assigned.
- **Job Title / Division / Department** — from BambooHR.
- **Account** — what their login is doing. Five states:
  - *No login needed* — their role says they never sign in. Most of the yard.
  - *No account* — nobody has invited them yet.
  - *Invited, not verified* — the invite was sent and not yet opened.
  - *Never signed in* — they set a password but have not used it.
  - *Last in <date>* — live.
- **HR Flag** — amber "Reported left <date>" means **BambooHR says this person
  has gone**, while Optix still lists them as active. It is a prompt for you,
  not something the system acts on. Deciding to terminate them in Optix is
  always a person's decision.

### Adding people

Three ways, all on `/people`:

1. **New person** — one at a time, by hand.
2. **Import** — a spreadsheet.
3. **Sync from → BambooHR** — see §6.

---

## 4. Logins, invites and passwords

### Most people never sign in

A login role carries a "needs login" flag. `crew` has it switched off, so
labourers, carpenters and operators show *No login needed* and are never
chased for an invite. They still hold tools; a foreman moves those tools for
them.

### Inviting somebody

`/people` → the row's **⋮** menu → **Invite**.

- The email field is pre-filled from their record but **you can type any
  address** — most of the yard has no company mailbox, so their record often
  has none.
- The invite address goes on their **login**, not on their employee record. So
  their Email column may stay blank afterwards. That is correct.
- They get a link, set a password, and land in first-run setup (§5).
- You will get a confirmation naming the address it went to. If you do not see
  that confirmation, it did not send.

### "Reset password" does NOT send an email

**This is the one to be careful with.** It:

- generates a temporary password,
- **signs them out of every device**, and
- shows you that password **once**, on screen.

Nothing is emailed. Copy the password and pass it to them yourself. If you
close that dialog without copying it, nobody knows the password and you have to
reset again.

They will be asked to choose their own password on their next sign-in.

### Deactivate vs delete

**Deactivate login** stops somebody signing in and keeps all their history.
That is almost always what you want.

**Delete** removes the person entirely and **refuses** if they hold any tools
or appear anywhere in custody history — it will tell you to set them to
*terminated* instead. Deleting cannot be undone.

---

## 5. First-run setup (the welcome wizard)

Anybody whose login role expects it is taken through five steps the first time
they sign in. Administrators, finance and office roles skip it — they have
nothing to set up.

It only appears if all of these are true: their role expects it, they are
linked to an employee record, and they are on at least one job's team. If a new
person sees no wizard, that last one is usually why.

**Step 4, "Your crew"**, is the useful one. It shows the tier above them and
every tier below, and lets them:

- **Confirm** somebody a subordinate already recorded,
- **Add another** person to a tier — several superintendents and several
  foremen per job are normal,
- **leave it** for whoever owns that decision ("My in-charge will handle
  this"), and
- **change their mind** — "I'll name them" withdraws that.

They can leave and come back; nothing is locked in, and **Skip setup** is
always available.

---

## 6. BambooHR sync

`/settings/integrations` → BambooHR, or the **Sync from** button on `/people`.

### It only ever reads

The sync makes `GET` requests. There is no code path that can write, update or
delete anything in BambooHR.

### Preview first. Always.

**Preview** reports what it *would* do and writes nothing. **Apply** writes.
Preview is the default because the destructive option should be the one you ask
for by name.

Read the preview numbers before applying. BambooHR holds roughly **1851
employee records for Urban, about 1578 of them former employees.** Applying
brings in all of them.

### What it does and does not touch

| | |
|---|---|
| **Creates** new people it has not seen | yes |
| **Updates** email, job title, division, department | yes |
| **Changes** an existing person's name or employee code | **never** — reported for you to confirm |
| **Sets** a login role | **never** |
| **Terminates or deactivates** anybody | **never** — flags them instead (the HR Flag column) |
| **Sends** invites | **never** — inviting stays manual |

### If it refuses

It will refuse to apply when BambooHR's own record count does not match the
number of records actually received — a partial read looks exactly like
hundreds of people having left. Run a preview and try again.

---

## 7. Jobs, crews and the ladder

### Team Roles (`/settings/team-roles`)

Defines the tiers a person can hold on a job and which tier each answers to.
Urban's is: Director → Area In-charge → Project Manager & General
Superintendent → Superintendent → Foreman.

You can add your own tiers, at any depth, with any names. **"Holds tools & a
truck"** on a tier means people on it can be handed custody — tick it and it
genuinely works.

Two things to know:

- Only administrators and the equipment department can fill a tier **you
  added**. The built-in PM/Superintendent/Foreman tiers have their own
  permissions; a tier you create does not, so a PM cannot fill it. This is a
  known limitation.
- Rows on your ladder are used for reporting structure and visibility, **not**
  for deciding what somebody may do. That is the login role.

### My Crew (`/my-crew`)

Where you claim the people who answer to you, job by job. It shows every tier
**at or below** yours and nothing above.

- **You can skip tiers.** A Director with no PM on a job can name the foreman
  directly. You will get a warning naming the tiers being stepped over, and
  then it lets you do it — because sometimes that is how the job actually runs.
- Somebody who already holds a tier **above** you is not offered.
- People BambooHR has flagged as gone are not offered.

You only see jobs you hold a team role on. If it says you are not on any jobs,
somebody with the right permission has to put you on one first.

---

## 8. Custody, in one page

- **Assign** hands a tool to somebody. **Transfer** moves it between people.
  **Return** brings it back.
- A tool over the tenant's **high-value threshold** needs a second signature —
  it is recorded as pending and nothing moves until it is approved. Below the
  threshold it applies immediately.
- The **High value** badge on the register is that same threshold, so a badged
  tool is exactly the one that will ask for approval.
- Moving a **trailer or gang box** moves what is inside it. That is one set of
  rules wherever you start from.
- Nothing falls due. There are no overdue loans — that model was removed. If a
  document mentions overdue tools it is describing a deleted feature.

---

## 9. Local testing notes

Only relevant if you are running Optix on your own machine.

- **Mailpit — http://localhost:8025** catches every email the system sends and
  delivers none of them. Invites, resets and alerts all land there with working
  links. Any address works, real or invented.
- `make seed-urban` loads Urban's real register (83 people, 753 tools, 20
  jobs). **It wipes the database first.**
- `make seed-demo` loads the synthetic test fixture. Required before running
  the test suite.
- `make reset-bare` empties everything and keeps only the two administrator
  logins.
- A newly seeded database has no logins for the 83 real people — invite them,
  or link an administrator login to an employee record to see the crew screens.

---

## 10. Things that are known to be wrong

Honest list, as of 2026-09-08.

- **Tiers you add do not appear on the jobsite hub.** A Director or Area
  In-charge row is written and auditable but shows on no jobsite card. The hub
  currently only understands PM, Superintendent and Foreman.
- **Only admins can fill a tier you created** (§7).
- **A role you create cannot be given custody in the pickers**, even with
  "holds tools" ticked, because the custodian pickers read a fixed list.
- **The custody reports** ("Assets by Foreman", "Assets by Mechanic") name two
  roles, so a custody-holding tier you added is in neither.
- **Most mutations still say nothing on success.** Invites, account actions and
  deletes confirm; the rest of the product does not yet.
- **`estimator` and `survey` roles disappear** if the database is reseeded —
  they were added by hand and are not in the seed.
