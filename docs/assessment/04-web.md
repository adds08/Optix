# Technical Assessment — Web App

**Date:** 2026-09-12
**Scope:** `apps/web` — 34,152 lines TS/TSX across 178 files (41% of the codebase)
**Method:** static analysis, full reads of the largest components, grep audits across `app/`, `components/`, `lib/`, `hooks/`
**Verdict:** **Better than average and type-safe to an unusual degree.** The debt is concentrated in two god-components, one duplicated predicate, and a systemic accessibility gap.

---

## Summary table

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | 140 form labels not associated with their control | **HIGH** | CONFIRMED |
| 2 | `jobsites/page.tsx` — 1,074-line single function | **HIGH** | CONFIRMED |
| 3 | Jobsites renders wrong-but-plausible data on partial query failure | **HIGH** | CONFIRMED |
| 4 | `data-table.tsx` CSV export reads post-pagination model | MEDIUM | CONFIRMED (latent) |
| 5 | `CUSTODIAN_ROLES` predicate duplicated 6× | MEDIUM | CONFIRMED |
| 6 | Error boundary is per-segment, not per-panel | MEDIUM | CONFIRMED |
| 7 | 3 screens fetch full tenant asset list for a subset | MEDIUM | CONFIRMED |
| 8 | 6 unlabeled icon-only buttons | LOW | CONFIRMED |
| 9 | `data-table.tsx` at 855 lines | LOW | CONFIRMED |
| 10 | `project-teams-panel.tsx` dependency-array mismatch | LOW | SUSPECTED |
| — | Zero `any` / `@ts-ignore` anywhere | — | CONFIRMED STRENGTH |
| — | Cache invalidation consistent across ~95 mutations | — | CONFIRMED STRENGTH |

---

## Correction to the CHANGELOG (read this first)

**The register's CSV export is NOT broken.** The v1.0.0 known-issues list states:

> CSV export from the register reads the post-pagination row model, so it exports one page.

This is **stale and should be removed**. Verified:

- The register's actual export is `exportAll` at `app/(app)/tools/page.tsx:405-423`, which maps `all` (`:122`, `list.data ?? []`) — **the complete unpaginated set**.
- The register passes `mode="client"`, `showToolbar={false}`, and **no `filename`** (`:667-691`), so `DataTable`'s own export button never renders there.

The underlying defect in `DataTable` is real but currently unreachable — see finding 4. **Recommendation: correct the CHANGELOG rather than "fix" the register.**

This matters beyond the one entry: it means the v1.0.0 known-issues list cannot be trusted as a work list without verifying each item against the code first.

---

## Confirmed strengths

**Type safety is effectively airtight.** Across `app/`, `components/`, `lib/`, `hooks/`:

```
as any ............. 0
@ts-ignore ......... 0
@ts-expect-error ... 0
: any .............. 0
as unknown ......... 2
```

17 non-null assertions exist; **all 17 were read and all are guarded** by an immediately preceding length or existence check. No `any` appears in any data-mapping path. This is the strongest dimension of the codebase and it is rare.

**Cache invalidation is disciplined.** 188 `invalidate()` calls against ~95 mutations. Files that looked bare on first pass were verified to invalidate through shared callbacks — `custody/page.tsx:64-73` (one `acted` handler invalidating 4 caches for all 4 approve/decline mutations), `rig-picker.tsx:126-131`, `employee-account-panel.tsx:22`. The single non-invalidating mutation is `settings/page.tsx:73` (`testEmail`), a probe that writes nothing. No stale-data-on-screen pattern was found.

**Design system rules hold.** Zero native `<select>` elements (a documented house rule). Only one non-semantic clickable in 178 files, and it is a correctly `aria-hidden` backdrop. All 5 raw `<table>` elements carry the shared `.sti-grid` class.

---

## Finding 1 — 140 form labels are not associated with their control (HIGH)

**CONFIRMED.** `<label className=...>` without `htmlFor` appears **140 times**. Only **10** labels in the entire app use `htmlFor`. These are verified as *siblings* of their inputs, not wrappers — e.g. `components/asset-form.tsx:144-145`, `:151-152`, `:155-156`, `:159-160`; `app/(app)/settings/page.tsx:109-110`.

Root cause: **there is no `components/ui/label.tsx`.** The shadcn `Label` primitive was never installed, so every form hand-rolls a bare `<label>`.

**Consequence.** Screen readers announce these inputs as unlabeled. Clicking label text does not focus the field. This is a WCAG 1.3.1 / 4.1.2 failure across essentially every form in the product — asset creation, settings, onboarding, user admin.

**Why this ranks highest.** It is the single most mechanical fix in this assessment (add `ui/label.tsx`, then pair `id`/`htmlFor`), it affects every form, and for a product being sold to construction firms — some of whom will have procurement accessibility requirements — it is the kind of gap that surfaces late and expensively.

---

## Finding 2 — `jobsites/page.tsx` is a god-component (HIGH)

**CONFIRMED.** `app/(app)/jobsites/page.tsx:70-1144` is **one 1,074-line function body**. Inside a single `JobsitesPage()`:

- 5 tRPC queries (`:71-78`)
- **17 `useState`** (`:105-214`)
- 4 `useMemo`, including a **273-line** `cards` computation (`:265-537`)
- 7 permission derivations
- an inline nested component (`:932`)

Only one other top-level function exists in the file.

**Consequence.** Every keystroke in the search box (`:105`) re-runs reconciliation across the whole tree. The 273-line `cards` memo cannot be tested in isolation. None of the jobs→crews→tools derivation can be reused — which is precisely why `jobsite-card-view.tsx` (445 lines) and `jobsite-crew-card.tsx` (415 lines) exist as near-parallel renderers.

The derivation at `:265-537` is **pure** and belongs in a `lib/` module where it can be unit-tested. This is not justified complexity.

---

## Finding 3 — Jobsites renders wrong-but-plausible data on partial failure (HIGH)

**CONFIRMED.** `app/(app)/jobsites/page.tsx:563-564` checks `assets` / `projects` / `vehicles` for loading, and `assets` / `projects` for error. **Not checked: `employees` (`:71`) and `team` (`:78`).** Both are consumed via `?? []` (`:245`, `:252`). `vehicles.isError` is also unhandled.

**Consequence.** If `employee.list` fails or is slow while the other three succeed, the page renders **fully and confidently** with every crew card empty and zero foremen in the picker — visually indistinguishable from "this job genuinely has no crew assigned."

This is the worst failure mode a register can have: **a silent wrong answer rather than an error.** For a system whose entire value proposition is that the register is trustworthy, this is a direct contradiction of the premise. It also connects to the stated launch problem — a user seeing an empty crew and concluding "the system lost my data" would be behaving rationally.

---

## Finding 4 — `data-table.tsx` CSV export reads the post-pagination model (MEDIUM, latent)

**CONFIRMED as a defect, but currently unreachable.** `components/sti/data-table/data-table.tsx:460`:

```ts
const pageRows = table.getRowModel().rows.map((r) => r.original);
```

In client mode `getPaginationRowModel` is active (`:441`), so `getRowModel()` is post-pagination. Two further defects in the same function: `:462` writes column **ids** rather than header labels, and `:468` emits `""` for any column without an `accessorFn`.

**Why it is unreachable today.** The export button only renders when `filename` is passed (`:636`). The only `DataTable` in the app passing it is the audit trail (`reports/audit-trail/page.tsx:113`), which is `mode="server"` (`:103`) — there `getPaginationRowModel` is `undefined`, so `getRowModel()` returns the single page the server sent, which is correct by accident.

**Consequence.** The first client-mode table given a `filename` silently exports one page with id-headers and blank columns. The correct reference implementation already exists at `components/sti/report-table.tsx:78-84`. Fix is `getPrePaginationRowModel()`.

---

## Finding 5 — `CUSTODIAN_ROLES` predicate duplicated 6× (MEDIUM)

**CONFIRMED.** Identical filtering logic, copy-pasted:

- `app/(app)/jobsites/page.tsx:243-251`
- `components/crew-assign-dialog.tsx:74-82`
- `components/assign-form.tsx:30-31`
- `components/transfer-form.tsx:23-24`
- `components/bulk-move-form.tsx:47-52`
- `components/vehicle-form.tsx:56-59`

Every one writes `CUSTODIAN_ROLES.includes(e.role as (typeof CUSTODIAN_ROLES)[number])`. Five of six also check `employmentStatus === "active"` — and **`crew-assign-dialog.tsx:78` and `jobsites/page.tsx:247` order the two conditions differently**. `jobsites/page.tsx:252` deliberately keeps a second `allCustodians` list that skips the active check.

Three of them then layer an *identical* `assets.view.crew` tier narrowing (`assign-form.tsx:32-34`, `transfer-form.tsx:26-29`, `bulk-move-form.tsx:54-56`).

`vehicle-form.tsx:49-55` carries a comment explicitly naming all six call sites — **the duplication is known and untreated.**

**Consequence.** Six places to forget when a custodian role is added. Combined with the cross-layer finding below, this is the web-side half of a system-wide problem.

**Cross-layer note.** `CUSTODIAN_ROLES` is a **compile-time constant**, while `role.can_hold_custody` is an **editable database column** surfaced in Settings. An admin who ticks that box changes nothing in any of these six components. The settings screen currently lies. Either wire it (one `role.custodianRoles` query + a shared `activeCustodians()` helper, ~1 day) or remove the toggle (~30 minutes). **A screen that cannot lie beats a screen that works.**

---

## Finding 6 — Error boundary is per-segment, not per-panel (MEDIUM)

**CONFIRMED, and the CHANGELOG claim is accurate but no stronger than stated.**

What exists:
- `app/(app)/error.tsx:23` — segment boundary inside the shell. Because `app/(app)/layout.tsx` holds the sidebar, a thrown render leaves navigation intact and replaces only the content pane. Uses Next 16's `retry()` with documented rationale (`:15-21`) and surfaces `error.digest` (`:60-62`).
- `app/global-error.tsx:20` — root boundary with its own `<html>/<body>`.

**The gap.** Coverage is per-*route-segment*, not per-*panel*. There are **zero** nested `error.tsx` files below `(app)` and no `react-error-boundary` usage anywhere. So on a composite screen like `/home` or `/jobsites`, one failing widget still blanks the entire content area.

There are also **no `loading.tsx` files anywhere** — all loading is manual `isLoading` branching, which is what allows finding 3 to happen.

---

## Finding 7 — Three screens fetch the full tenant asset list for a subset (MEDIUM)

**CONFIRMED.**

- `app/(app)/equipment/[id]/page.tsx:30` — unfiltered `asset.list.useQuery()`, then filters client-side at `:34` to one vehicle's location. The file's own comment (`:24-25`) concedes a server-side filter is wanted.
- `components/crew-assign-dialog.tsx:65` — full list for a dialog picker.

`asset.list` already accepts `{ status, projectId, custodianId }`, and `my-tools/page.tsx:20`, `people/[id]/page.tsx:35` and `assign-form.tsx:17` all use it correctly.

**Consequence.** An equipment detail page downloads all ~754 assets to show the handful aboard one truck.

**Do not "fix" the register.** `tools/page.tsx:121` fetches the full set **deliberately** — the facet counts require the unfiltered data, per the documented rule in `.claude/rules/web.md`.

---

## Findings 8–10 (LOW)

**8 — Unlabeled icon buttons.** 6 instances of `<Button size="icon">` with no `aria-label`. Only 69 `aria-label` and 19 `role=` across 178 files. `DataTable` does this correctly (`:325`, `:344`), so the pattern is known and merely unevenly applied.

**9 — `data-table.tsx` at 855 lines.** Bundles dual client/server mode, column resize with localStorage persistence, left-prefix freeze via DOM measurement, right-sticky actions, row pinning, selection, CSV export, and toolbar. **More defensible than finding 2** — it is a leaf primitive with 12 consumers whose concerns genuinely couple through one TanStack table instance, and it already delegates to 5 sibling files. Clean extractable seams: the storage helpers (`:144-194`, pure) and `exportCsv` (`:459-473`). Worth splitting, not urgent.

**10 — SUSPECTED.** `components/project-teams-panel.tsx:116` keys its effect on `[query.data, projectId]` but reads `projects`, an unlisted dependency. A stale closure could leave `projectId` unset on a slow first load. **Not reproduced at runtime** — this is a static read of a dependency-array mismatch.

---

## Recommended actions, in order

1. **Add `components/ui/label.tsx` and pair `id`/`htmlFor`** (finding 1). Mechanical, affects every form, highest leverage.
2. **Add the two missing query guards in `jobsites/page.tsx`** (finding 3). A few lines; removes the system's worst failure mode — the confident wrong answer.
3. **Correct the CHANGELOG's CSV entry**, and fix `data-table.tsx:460` to `getPrePaginationRowModel()` while it is cheap and latent (finding 4).
4. **Extract `activeCustodians()` / `narrowToTier()` helpers** (finding 5), and decide the `can_hold_custody` question — wire it or remove the toggle.
5. **Extract the `cards` derivation from `jobsites/page.tsx` into `lib/`** (finding 2), where it becomes testable.
6. Add `aria-label` to the 6 icon buttons (finding 8) — a 10-minute task.

Items 1–3 are small and high-value. Item 5 is the largest piece of work in this document and should not be started before items 1–4 are done.
