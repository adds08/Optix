# STInventory — Executive Summary

> One-page distilled pitch for Urban leadership. Why this exists, what it costs to do
> nothing, and what STInventory changes.

---

**Urban Infraconstruction owns expensive tools. It does not know where they are.**

Today, tool custody is tracked in a **spreadsheet that no one updates**, on **paper tags
that fall off**, and in **WhatsApp threads buried under project updates and lunch orders**.
When a foreman needs a tool, he walks the yard or buys a new one. When a foreman is
terminated, nobody systematically asks "what did he have?" When a project closes, nobody
reliably recovers the fleet. The result is predictable: tools get lost, projects get
delayed, and Urban buys the same thing twice.

## The hidden cost

- **Capital waste:** Unknown inventory forces reactive purchases. Missing tools are
  replaced rather than found.
- **Delay cost:** A crew standing around waiting for a missing concrete vibrator or survey
  unit burns budget at the crew's hourly rate, not the tool's rental cost.
- **Audit risk:** Financial ownership (`which project paid for this?`) and physical custody
  (`who has it now?`) are currently the same judgment call. This muddles project cost
  allocation and FoundationSoft reconciliation.

## The hard cases a spreadsheet cannot solve

1. **Foreman on multiple projects** — The same person holds tools on Legacy West and
   Trinity Bridge. A spreadsheet row cannot represent two locations for one foreman.
2. **Temporary loan** — UIC-1012 was due back June 25. Nobody remembered because there is
   no alert engine. The spreadsheet has no timer.
3. **HR offboarding / termination** — James Whitaker left. The spreadsheet still shows him
   as custodian. There is no clearance queue, no gate, no block.
4. **Phase change** — Phase 2 ends. The tools on it are now idle. Nobody automatically
   surfaces them for reassignment.
5. **Lost / damaged** — A tool goes missing. The team opens a new Purchase Request because
   there is no "investigate" state to manage the gap.
6. **Procurement timing** — By the time the shortage is visible in WhatsApp, the project
   has already started and the replacement has a 2–4 week lead time.

## What STInventory changes

**Every tool gets a digital custody chain.** From the moment a tool is received and tagged,
every hand-off — to a foreman, to a new project, to the repair shop, back to the warehouse
— is an immutable transaction. The current location, custodian, and project are not
"entered" in a cell; they are **derived** from the unbroken chain of hand-offs.

This means:

- **You cannot lose a tool without the system knowing** it is unaccounted for.
- **You cannot fire a foreman without triggering a clearance queue** that blocks HR
  sign-off until every tool is returned, transferred, or marked lost.
- **You cannot miss a due date** because temporary loans have automatic overdue alerts.
- **You cannot duplicate purchases** because idle tools on closed phases are surfaced for
  reassignment.
- **You can answer "who paid for this?" in one click**, even while the tool is physically
  on another job site.

**And the WhatsApp thread moves inside the system.** The reason custody data never got
recorded is that WhatsApp costs one sentence and a form costs a minute in the cab of a truck.
So STInventory takes the sentence. A foreman types "gave the rotary hammer UIC-1012 to Dwayne
for Trinity Bridge" into the equipment channel, exactly as he would have texted it, and the
system turns it into a proposed custody transaction he confirms with one tap. Same effort as
the group chat — except now it lands in the register, the audit trail, and the reports.

## Why this is low risk

The system is modeled on the same operating shape United Rentals uses (catalog → warehouse
inventory → dispatch → charge-to-project), but applied internally. No marketplace, no
external rental billing — simpler than UR, same inventory discipline.

**Scope A — MVP ($105K, 14 weeks):** Asset register + assignments/transfers + core reports.
Get the real tool fleet into the system and force the first hand-off to be digital.

**Then Phase B ($155K, 20 weeks):** Add maintenance, HR clearance, full reporting. Once
the register is live, the operational modules are force multipliers.

**SaaS optional:** Built multi-tenant-ready from day one. If Urban decides to productize,
no rewrite needed.

---

> **STInventory turns tool custody from a memory game into an audit trail.**
