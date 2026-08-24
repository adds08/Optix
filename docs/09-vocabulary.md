# Vocabulary

What the screens say, and what they should say. Nothing here is implemented yet.

The rule: a word earns its place on screen if a foreman or an equipment clerk
would say it out loud. Words that exist because the data model needed them —
custodian, asset, intake, projection — belong in the code, not the interface.

Scope is **user-visible strings only**. Database columns, event types
(`assign`, `transfer`, `tag`), permission names and `message.intent_type` values
stay as they are: renaming them is a migration against an append-only ledger,
with real risk and nothing a user would ever notice.

## Decided

| Current | Becomes | Notes |
|---|---|---|
| Hand Off | **Hand Off** | Unchanged. |
| custodian | **holder** | "Holder" in tables and labels; elsewhere just the person's name. |
| Custodian (column) | **Holder** | |
| Custody chain | **History** | |
| Custody (nav item) | **Who Has What** | The screen answers that question; "Custody" names a legal concept. |
| asset, assets | **tool, tools** | |
| Asset (as a category) | **small tools** | The official name of the class of thing. |
| New Asset | **Add a tool** | |
| Idle Assets | **In the yard** | |
| job, job site | **project** | Used interchangeably in speech; the interface picks one. Matches FoundationSoft and the nav item. Done. |

## Field-facing — needs your call

These are read by foremen on a phone.

| Current | Proposed | Why it matters |
|---|---|---|
| "It becomes a **custody action** you confirm" | "We'll write it down for you to check" | "Custody action" is two abstractions in a row. |
| "Custody is tracked against an employee. Ask the equipment desk to link your account." | "Your login isn't linked to your name on the crew yet. Ask the equipment desk." | Current version explains the data model instead of the problem. |
| "This login is not linked to a **field record**" | "…not linked to anyone on the crew" | |
| "When the yard **issues** you something, it appears here" | "When the yard gives you something…" | |
| Awaiting approval | **Waiting on the desk** | Says who is holding it up. |
| In motion / Moving | **On the way** | |
| Still out | **Still out** | Already plain. Keep. |
| Overdue | **Overdue** | Keep — universally understood. |

## Desk-facing — needs your call

| Current | Proposed | Why it matters |
|---|---|---|
| Tool Register | **Small Tools** | Matches the official name. "Register" is fine but redundant next to it. |
| Intake / "imported without an **intake event**" | **Added** / "added without a first record" | Warehouse jargon. |
| Idle capital | **Money sitting in the yard** | |
| Total capital | **Total value** | |
| **Fleet value** | **Total value** | Contradicts a decision you already made: trucks and trailers are locations that move, not a fleet. This label reintroduces the word the product rejected. |
| HR clearance / clearance queue | **Leavers still holding tools** | Names the actual problem. |
| Held by terminated staff | **Held by people who have left** | |
| High-value threshold | **Needs a second signature above** | Describes what it does rather than what it is. |
| High value (badge) | **Needs sign-off** | |
| Write-down / Total write-down | **Value lost** | |
| "Everything below is **folded** from the **transaction log**" | "Everything below is built from the tool's history" | "Folded" is event-sourcing vocabulary. |
| Verification queue | **Messages to check** | |
| Unresolved messages | **Messages nobody has dealt with** | |
| Serialized tool / bulk line | **Tagged tool / bulk item** | "Serialized" is inventory-systems jargon; the distinction users see is whether it has a tag. |
| Postings / "No postings recorded" | **Job history** | |
| Field capture (section label) | **From the field** | |
| Field requests | **Requests from the field** | |
| Assignments | **Hand-outs** or keep | Weakest of these. "Assignment" is common enough in construction that it may be fine. |

## Leaking implementation — fix regardless

These are not jargon choices, they are internal words that escaped.

| Current | Proposed |
|---|---|
| "This record does not exist in your **tenant**" | "This record doesn't exist, or it was removed." |
| "This tag does not exist in your **tenant**" | "No tool has that tag." |
| "Check that the **API** is running, then reload" | "Couldn't reach the system. Try again in a moment." |

"Tenant" is SaaS plumbing. Nobody at Urban is a tenant of anything, and the
sentence is shown to a user who cannot act on it.

## Keep as-is

| Term | Why |
|---|---|
| Cost code | FoundationSoft's term, and the accounting team's. Real vocabulary. |
| Cat class | United Rentals' own catalogue term. Changing it breaks the match to their paperwork. |
| Charged to / Owning project | Already plain, and the distinction from "who's using it" is the point. |
| Job site | Actual field word. |
| Transfer | Understood, and it is what the paperwork says. |
| Overdue, Missing, Damaged | Plain already. |
| STInventory | Product name. |

## One open question

"Small Tools" is the official name of the category, so the register should carry
it. But the nav sits inside a product that is only about small tools, which
makes "Small Tools" as a nav label slightly redundant — like a folder called
"Files". Options:

- Nav says **Tools**, page heading says **Small Tools**
- Both say **Small Tools**
- Nav says **All Tools**, to distinguish it from a foreman's **My Tools**

The third reads best against the existing "My Tools", and is what I would pick.

## Words this document used to assert, and should not have

Checked against the code and with Urban, 2026-08-24.

| Word | Standing |
|---|---|
| **Gang box** | Real trade word — a shared lockable site chest. **Urban does not use it.** It survives as one of five `LOCATION_TYPES` with **zero rows in the seed**, alongside `site_container` and `project_site`. This document listed it under "actual field words" and nobody had checked. Do not put it on a screen |
| **Yard** | Kept in the phrases above — "in the yard", "money sitting in the yard" — where it reads as *not out on a job*. That is the only meaning it carries. **There is no yard entity**, no yard register and no yard screen. A tool with no project is in the pool, and the Pool tab on Tools by Jobsite is where it shows |
| **Warehouse** | A table, and the only `LOCATION_TYPE` the seed creates. Not a user-facing word — say **pool** |

The general point, which cost a review cycle: this file describes **what screens say**. A row
here that asserts what Urban's people *call* something is a claim about the world, and it
needs the same verification as a claim about the code. Two of the three above were wrong.
