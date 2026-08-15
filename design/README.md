# Design concepts — Release 1

Imported from the Claude Design project `548e0b19-e449-49b6-8b26-d5a76eb533dd`.

These are **concept screens, not implementation targets.** Neither file is to be ported.
They exist to settle two arguments: what a dense operational table should feel like, and
what shape a per-PM generated dashboard takes. Read the concept, take the idea, build it
in the app's own token system (see ADR-7).

**Neither concept is needed for Sprint 1 (24 August).** Sprint 1 is deliberately
backend- and schema-heavy precisely because these designs are still being worked. The work
they inform starts in **Sprint 2** — Blocky tokens (STI-1001) and the dashboard (STI-900s)
— with the Equipment department management view (STI-401) and the Blocky migration
(STI-1002) in Sprint 3.

## Files

| File | What it is | How to use it |
|---|---|---|
| `claude-design/Tools by Jobsite Blocky.dc.html` | Alternative visual language for `/jobsites` — dark, flat, monospace-numeric, zero rounding | **Adopted** as the product's visual language (ADR-7). Feeds STI-1001 in S2, STI-401 in S3. Still not ported verbatim |
| `claude-design/PM Desk in Shell.dc.html` | A PM-shaped app shell with a "Request Desk" and an LLM answer pane | **Rough concept only.** Reference for the dashboard epic (STI-900s). Do not replicate |
| `claude-design/PM Desk.dc.html` | The same Request Desk without the shell — earlier iteration | Background |
| `claude-design/support.js` | The `dc-runtime` these files import (`x-dc`, `sc-for`, `sc-if`, `DCLogic`) | Needed only to open the concepts locally |

To view one: open the `.dc.html` file in a browser. `support.js` must sit beside it.

> Not imported: the superseded iterations (`STInventory v2/v3`, `Tools by Jobsite
> 2/Board/copy`, `FieldChat`) and the `screenshots/` + `uploads/` PNGs. They are still in
> the Claude Design project if anyone wants them.

---

## Concept 1 — "Blocky", for Tools by Jobsite

The current `/jobsites` is shadcn-default: rounded cards, soft borders, proportional
numerals. The Blocky concept argues the opposite for this one screen, because this screen
is a **yard manifest**, not a marketing surface.

### What it actually changes

| Dimension | Current | Blocky |
|---|---|---|
| Radius | `rounded-lg` throughout | `4px` on containers, `3px` on chips. Nothing softer |
| Numerals | Proportional, inherit body font | **JetBrains Mono** for every tag, unit number, count, currency, and column header |
| Density | Card padding, generous gaps | 8–10px row padding, 12px between job blocks |
| Hierarchy | Card elevation and shadow | A 3px **left edge bar** per job — amber when the job has a vehicle gap, blue when clean |
| Row separation | Borders | Zebra striping on tool rows (`#0A0D11` / `#0C1014`) |
| Status | Badge components | Bare coloured text, right-aligned, fixed column width |

### The interaction model worth stealing

Three levels of disclosure on one page, no navigation:

```
Job block  (always visible: name, JOB code, city, gap warning, crew/tool summary)
  └── metric strip   TOOLS OUT · CREWS · TRUCKS n/N · TRAILERS n/N · VALUE
        └── crew row  (foreman, truck chip, trailer chip, last-updated, tool count)
              └── tool table  TAG · TOOL · CATEGORY · TIME OUT · CONDITION
```

- Job blocks default **open**, crew rows default **closed**. The manifest is legible on
  load without a click, and drilling to a specific tool takes exactly one.
- **The gap is the headline.** A crew without a truck or trailer renders `+ truck` /
  `+ trailer` as an amber, clickable chip *in the position the value would occupy*. The
  absence is the affordance. Clicking opens an inline picker of unassigned vehicles —
  no modal, no page change. This maps directly onto STI-401.
- A crew tick is green only when **both** truck and trailer are present. Partial is amber.
- The "Needs vehicle" toolbar chip filters to jobs with gaps. This is the equipment
  department's actual morning question.
- Header summary reads `WITH TRUCK 7/9` — coloured green at parity, amber otherwise.
  Ratios, not raw counts, because the denominator is the point.
- An "Unassigned pool" tab lists tools in warehouses with an idle-days count.

### What to do with it

Take the **information architecture and the gap-as-affordance idea**, and the visual
language wholesale — this concept is now ADR-7, the product's design direction.

The palette is the one thing not taken verbatim. The concept hard-codes dark-only hex
values; the app has an oklch token system in `apps/web/app/globals.css` that must work in
both themes and keeps `--ok` / `--warn` / `--crit` / `--idle` reserved for status. Blocky
becomes a variant of the existing primitives, not a parallel stylesheet — see STI-1001.

---

## Concept 2 — PM Desk (rough)

**Read the caveat first: this one is deliberately rough and must not be replicated.** It
is here for one reason — it is the only artefact that shows what "a dashboard a PM
generates for themselves" looks like when it is a working surface rather than a widget
grid. Take ideas; take no markup.

### The three ideas worth keeping

**1. A third navigation shape.** `nav-config.ts` has exactly two shapes today — `FIELD_NAV`
(foreman, superintendent) and `DESK_NAV` (everyone else) — and the file says that is
deliberate. A PM falls through to `DESK_NAV` and therefore gets the equipment
administrator's surface. The concept proposes a **PROJECT shape**: Overview / My jobs /
Requests / Insight. A PM runs jobs, not the yard. This is a real finding and it feeds
STI-803.

**2. The status board is the filter.** Under the header sits a row of large numbers —
each one clickable, each one setting a filter on the list below. There is no separate
filter UI for the primary cuts. KPI tiles that don't filter are decoration; these earn
their space.

**3. The answer pane is scoped, then rendered.** A right-hand "Ask the desk" pane takes a
plain-language question and returns a composed answer: prose line, three fact tiles, a
short result list, then two actions — **Apply as filter** and **Raise a request from
this**. The generated view is not a dead end; it lands back in the real UI.

> **The security rule this concept encodes, which is non-negotiable in implementation:**
> the model chooses *presentation*, never *scope*. Authorisation is applied to the query
> before execution, never as a post-filter over results. See `docs/workings/SYSTEM_PLAN.md`
> §7 and STI-903.

### What it gets right that we should copy

- Theme tokens are lifted verbatim from `apps/web/app/globals.css` (`--background`,
  `--card`, `--border`, `--primary`, `--ok`, `--warn`, `--crit`, `--idle`). Status hues are
  reserved and never decorative. Keep that discipline.
- The new-request drawer previews its routing before submit (`routePreview`), and states
  plainly that nothing auto-approves — a request is raised unassigned and a desk claims it.
- Requests carry a **reading**: "Recognized — action ready to replay on approval" vs
  "Unrecognized — no action bound, needs a human". That is `task.actionType` +
  `task.pendingAction`, which already exist. The concept just surfaces them honestly.

### What to ignore

The Request Desk domain itself — request routing to vendors, SLAs, procurement queues — is
**out of scope for Sprint 1 (24 August)**. It is the Release 2 procurement shape wearing a dashboard
costume. Do not build it. Deliverable 5 for this release is file attachments on a project
or foreman, nothing more (STI-600s, Sprint 4).

---

## Decisions taken, 2026-08-15

Two of the three questions below are now answered. Recorded properly in **ADR-7**
(`docs/06-decisions.md`); summarised here so this file is not read in isolation.

**1. Blocky is adopted as the product's visual language.** The layout is agreed; the palette
is not yet confirmed. It ships as `E10 · STI-1000s`: tokens and restyled primitives in
Sprint 2, existing screens migrated in Sprint 3.

**The shadcn *look* is dropped; the Radix primitives underneath it stay.** Blocky specifies
density, colour and typography and contains no component behaviour, so there is nothing in
it that requires replacing dialogs, popovers or comboboxes. Rebuilding those by hand would
cost weeks and regress accessibility that works today.

**2. The palette must be expressed in the existing oklch tokens**, not adopted as the
concept's hex values. The concept is a dark-only mockup; the app works in both themes and
reserves `--ok` / `--warn` / `--crit` / `--idle` for status. This is the unconfirmed half of
the Blocky decision and is STI-1001's first task.

**3. PM Desk is not the dashboard design.** The generated, LLM-ask dashboard (`E9 ·
STI-900s`, now Sprint 2) is a separate concept. Take the three ideas listed above from PM
Desk — the third nav shape, the status board as filter, the scoped answer pane — and design
the dashboard itself fresh.

> Also note: the **field conversational layer** (a foreman types a sentence, it becomes a
> custody action) is **deprioritised** and not currently scheduled. That is a different
> surface from the dashboard's LLM ask, which is in Sprint 2. Both use `packages/intent`;
> only one is scheduled.

## Design decisions still owed

1. **Confirm the Blocky palette against the oklch tokens.** STI-1001's first task, and the
   one part of ADR-7 recorded as provisional.
2. **Does the PM get a third nav shape?** Explained plainly: `nav-config.ts` has two menus
   today — `FIELD_NAV` (foreman, superintendent) and `DESK_NAV` (everyone else). A PM lands
   on `DESK_NAV`, which is the *equipment administrator's* menu: yard, warehouse, asset
   management. Two options. **(a)** Give PMs and Engineers their own menu — Overview / My
   jobs / Requests / Insight. **(b)** Leave them on `DESK_NAV` and let project scoping hide
   what they cannot reach, so the menu is the same but the contents are filtered. (a) is
   clearer and costs a third nav config; (b) is free but leaves a PM looking at yard menus.
   STI-803 assumes (b) unless told otherwise.
