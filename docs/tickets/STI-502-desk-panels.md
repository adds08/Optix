# STI-502 — The five Release 1 panels

**Phase:** 5 — Desk views by role
**Size:** 2 units
**Status:** BLOCKED by STI-501

---

## Why this exists

`SYSTEM_PLAN.md` §6.5 names the Release 1 panel set:

```
Panel('tools.by_jobsite',  'assets.view.project', ToolsByJobsite)
Panel('tools.mine',        'assets.view.own',     MyTools)
Panel('crew.tools',        'assets.view.crew',    CrewTools)
Panel('desk.queue',        'custody.verify',      PendingQueue)
Panel('tools.overdue',     'assets.view.all',     OverdueTools)
```

Verified 2026-08-16 — none exists as a panel. Rough page-level equivalents exist for
three, and two have nothing at all:

| Panel | Today |
|---|---|
| `tools.by_jobsite` | `apps/web/app/(app)/jobsites/page.tsx` — a page; joins 4 client-side queries in the browser (`:63-67`) |
| `tools.mine` | `apps/web/app/(app)/my-tools/page.tsx:20` — a page |
| `crew.tools` | `apps/web/components/jobsite-crew-card.tsx` — a card, not a registered panel |
| `desk.queue` | **nothing** — becomes reachable via STI-105 |
| `tools.overdue` | **nothing** — only an escalation setting and a `request_overdue` notification type (`apps/api/src/request-worker.ts:225`) |

## Acceptance criteria

1. All five registered in STI-501's registry with the permissions above.
2. Existing screens are **reused, not duplicated**. `my-tools` and `jobsites` already
   work; wrap them as panels. A second implementation of "tools by jobsite" that
   drifts from the first is worse than no panel.
3. `tools.by_jobsite` shows **holder, truck and trailer** against each tool
   (§6.5). Truck and trailer come from STI-203 — if that has not landed, the panel
   ships with holder only and says so, rather than inventing a source.
4. `desk.queue` is the STI-105 queue, and the borrow-versus-held distinction stays
   visible inside the panel.
5. `tools.overdue` is new. **Beware the known trap** (`CLAUDE.md`): the domain rule
   uses strict `<` while the notification worker uses `lte`, so an overdue alert
   fires a day early. The panel must agree with the *domain rule*, and the
   disagreement should be reported — not silently copied into a third place.
6. `tools.by_jobsite:63-67` joins four queries in the browser. If that is slow at the
   panel's data volume, report it; do not rewrite it as part of this ticket.
7. Each panel verified in a browser under a role that should see it and one that
   should not.

## Files

- `apps/web/app/(app)/jobsites/page.tsx:63-67`
- `apps/web/app/(app)/my-tools/page.tsx:20`
- `apps/web/components/jobsite-crew-card.tsx`
- `apps/web/app/(app)/custody/page.tsx` — the STI-105 queue
- `apps/api/src/request-worker.ts:225` — the overdue notification and its `lte`
- `packages/domain/src/rules.ts` — the authoritative overdue rule
