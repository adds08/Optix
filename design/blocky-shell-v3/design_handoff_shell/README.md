# Handoff: Dashboard + AI Assistant panel

## What this is — and what it deliberately is *not*

You asked me to convert `System Shell v3.dc.html` into Next.js/TypeScript. Reading your repo changed the answer, so read this section before the code.

**Your shell already exists and is better than mine.** `apps/web/components/sti/app-shell.tsx` + `app-sidebar.tsx` already give you: the shadcn sidebar-07 skeleton, `SidebarProvider` with `collapsible="icon"` (the collapsible secondary sidebar I was asked to add — you already had it), the one-viewport / one-scroll-region frame from the 2026-08-07 changelog, real auth guarding, tRPC `identity.me`, the theme store, `GlobalSearch` gated on field roles, and permission filtering per nav row.

Re-emitting that as new TSX would hand you a worse copy of code you already run — no `SidebarProvider`, no cookie-persisted rail state, no phone sheet, no auth guard, 700 lines of inline style objects instead of your tokens.

**So this bundle contains only the parts of the design that do not exist upstream:**

| Component | Status upstream |
| --- | --- |
| Shell frame, rail, sidebar, top bar, theme toggle, search | **Already yours — do not replace** |
| Nav config + permission gating | **Already yours — do not replace** |
| Dashboard: AI briefing bar, metric grid, attention feeds | New — in this bundle |
| AI Assistant slide-out panel with session history | New — in this bundle |
| Tools by Jobsite board | Already at `/jobsites` |

## Fidelity

**High-fidelity.** Colors, type, spacing and states are final. But the files here are written **as production TSX in your conventions**, not as HTML to translate — they use Tailwind v4 utilities against your own tokens, `cn()` from `@/lib/utils`, shadcn primitives, and `lucide-react`. There is **no hardcoded hex anywhere**; every color resolves through `globals.css`, so light/dark and the theme store keep working for free.

## Files

```
components/sti/dashboard/ai-briefing.tsx      briefing bar with hazard edge
components/sti/dashboard/metric-grid.tsx      6-up metric row
components/sti/dashboard/attention-feed.tsx   "Needs you" / "Stuck" feeds
components/sti/ai-panel.tsx                   slide-out assistant + sessions
app/(app)/home/dashboard-view.tsx             composition of the above
```

Drop them at those paths under `apps/web/`. Every import already matches your aliases.

## Tokens used — all existing

Confirmed present in `apps/web/app/globals.css`:

- `--ok` / `--ok-bg` and `--warn` / `--warn-bg`, exposed to Tailwind as `text-ok bg-ok-bg text-warn bg-warn-bg`
- shadcn semantics: `bg-card`, `bg-background`, `border`, `text-muted-foreground`, `text-foreground`, `bg-accent`, `text-destructive`
- utilities `.label-xs` (mono 11px uppercase, tracking .14em) and `.tag-num` — used instead of respelling those rules
- `.sti-scroll` for scroll regions, `.sti-hazard-edge` for the briefing bar's left edge

**Nothing new was added to `globals.css`.** If a status needs a third tone beyond ok/warn, use `text-destructive` rather than inventing a token.

## Wiring — the only real work left

Everything renders from props; no component fetches. Suggested queries:

| Component | Prop | Source |
| --- | --- | --- |
| `AiBriefing` | `text` | `trpc.dashboard.briefing` (new procedure) |
| `MetricGrid` | `metrics` | `trpc.dashboard.metrics` — see `docs/14-dashboard-additions.md` |
| `AttentionFeed` | `rows` | `trpc.dashboard.needsYou` / `.stuck` |
| `AiPanel` | `sessions` | `trpc.chat.*` — the `/chat` page already has this shape |

The sample arrays in `dashboard-view.tsx` are marked `// TODO(api)` and exist only so the page renders before those procedures land. Delete them when you wire it.

## Behavior

- **Metric grid** — `grid-cols-2 md:grid-cols-3 xl:grid-cols-6`. Tone drives only the value color: `crit → text-destructive`, `warn → text-warn`, default `text-foreground`.
- **Attention feeds** — two cards, `lg:grid-cols-2`, stacking on narrow. Each row is a 34px flex line: mark chip (56px, tinted by tone) · tag (`.tag-num`) · description (truncates) · age (turns `text-warn` past a day). Rows are `border-b` except the last.
- **AI panel** — fixed right, 400px, `w-full sm:w-[400px]`. Enter sends, Shift+Enter newlines. Opening sets focus; Escape closes. Session list collapses. Uses your `Sheet` primitive so the phone case and focus trap come free — that is a change from my HTML, which hand-rolled the overlay.
- **Briefing bar** — one line of copy, `.sti-hazard-edge` on the left, "Open chat →" opens the AI panel.

## Accessibility notes

The HTML prototype used `<div onClick>` throughout because it was a mock. The TSX here does not: interactive rows are `<button>`, the panel is a `Sheet` with a labelled close, mark chips carry `aria-label` with the full status word, and the metric values are `<dl>`/`<dt>`/`<dd>` pairs so a screen reader gets label-and-value rather than a bare number.

## What I did not build

- **Nav, rail, top bar, theme toggle** — yours, deliberately untouched.
- **PM Desk / Main Desk** — those designs were deleted this session at your request; nothing here covers the PM request/approval board.
- **Placeholder pages** — 11 of the 14 real nav rows still have no design. The prototype showed an honest placeholder; I have not faked screens for them.
