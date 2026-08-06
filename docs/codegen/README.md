# Job selector + job groups — how to land this in STInventory

Frontend-only change. Every procedure it calls already exists in
`packages/api-contracts/src/routers/projectGroup.ts` (`mine`, `list`, `create`,
`update`, `delete`, `setProjects`, `setUsers`, `userOptions`) plus `project.list`.
No schema, no API work.

## What changes, and why

**Before:** the sidebar switcher was a `DropdownMenu` that printed every group
*and* every job as a flat list of items, with the group's jobs nested underneath
as indented menu items. Group management lived in a second place (`JobGroupsNav`
in the sidebar), and the `/job-groups` page was three columns with a read-only
"all projects" column.

**After:**

1. **One panel, two panes** (`Popover`, not `DropdownMenu`).
   Left = scopes: **All your projects** (a permanent, un-editable group) and the
   user's job groups, searchable by group name. Right = the jobs inside the
   highlighted scope, with its own job search, a "Show all …" row, and one row
   per job. Nothing is nested; nothing is a submenu.
2. **`DropdownMenu` cannot hold a search input** — Radix's menu typeahead
   swallows keystrokes. That is the whole reason for the new `ui/popover.tsx`.
3. **Group editing lives in the pane header** (pencil → the existing
   `JobGroupModal`). The sidebar's separate `JobGroupsNav` block is deleted.
4. **Mobile**: the same popover renders as one column with a Back button
   (`useIsMobile()`), since two 280px panes do not fit a 390px screen.
5. **`/job-groups`** becomes two panes — group list + the selected group's jobs
   with a search — and each tick writes immediately via `setProjects`.
6. **Modal** gains a job search, a people search, and "N of M selected"
   counters. Search filters the visible rows only; it never clears ticks.

## Files

| Action | Path |
|---|---|
| add | `apps/web/components/ui/popover.tsx` |
| replace | `apps/web/components/project-switcher.tsx` |
| replace | `apps/web/components/job-group-modal.tsx` |
| replace | `apps/web/app/(app)/job-groups/page.tsx` |
| edit | `apps/web/components/app-sidebar.tsx` — drop `JobGroupsNav` |
| delete | `apps/web/components/job-groups-nav.tsx` |

`app-sidebar.tsx` edit: remove the `import { JobGroupsNav } …` line and the
`<JobGroupsNav />` line at the end of `<SidebarContent>`, and drop the stale
"then the expandable Job Groups column" sentence from the header comment.

## shadcn bits

`Popover` is the only new primitive. The repo pins Radix via the single
`radix-ui` package (see `components/ui/dropdown-menu.tsx`), so it needs no
install — `import { Popover as Primitive } from "radix-ui"`. `components.json`
is already wired if you would rather run `pnpm dlx shadcn@latest add popover`,
but then re-style the generated file to match `dropdown-menu.tsx` (same
`bg-popover`, `border`, `shadow-md`, `rounded-md`, animation data-attributes).

Everything else is existing app code: `Input`, `Button`, `Dialog`,
`SidebarMenuButton`, `useJobScope()`, `usePermissions()`, `useIsMobile()`,
`idName()`, `cn()`, and lucide icons (`Check`, `ChevronRight`, `ChevronsUpDown`,
`FolderKanban`, `Pencil`, `Plus`, `Search`).

Tailwind v4 numeric utilities used: `h-100` (400px), `h-105`, `w-68`, `w-72`,
`basis-65`, `basis-85`, `h-9.5`. If your Tailwind rejects any of them, swap for
`h-[400px]`, `h-[420px]`, `w-[272px]`, `basis-[260px]`, `basis-[340px]`,
`h-[38px]`.

## Prompt to paste into your local coding agent

> In the STInventory monorepo (`apps/web`, Next.js 15 App Router, Tailwind v4,
> shadcn/ui, tRPC), rework the sidebar job selector and job-group management.
> This is frontend-only: `trpc.projectGroup.{mine,list,create,update,delete,setProjects,setUsers,userOptions}`
> and `trpc.project.list` already exist — do not touch the API, DB or schema.
>
> 1. Add `components/ui/popover.tsx` wrapping `Popover` from the `radix-ui`
>    package, styled exactly like `components/ui/dropdown-menu.tsx`
>    (`z-50 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md`,
>    same open/close animation data-attributes), exporting `Popover`,
>    `PopoverTrigger`, `PopoverAnchor`, `PopoverContent`.
> 2. Rewrite `components/project-switcher.tsx`. Keep the existing
>    `SidebarMenuButton` trigger (FolderKanban tile, label, "N jobs",
>    ChevronsUpDown). Replace the DropdownMenu body with a Popover holding two
>    panes side by side in one 400px-tall panel:
>    - Left (272px): a "Search groups…" input, a JOBS section with a single
>      "All your projects" row (job count + ChevronRight; treat it as a
>      permanent, un-editable group), a JOB GROUPS section listing
>      `useJobScope().groups` (name, job count, ChevronRight), and a footer
>      "Create new group" button gated on `has("project.manage")`.
>    - Right (288px, `border-l`): header with the highlighted scope's name, its
>      job count and — for a real group only — a pencil icon-button that opens
>      `JobGroupModal` in edit mode; then a "Search jobs…" input; then a
>      "Show all projects" / "Show all in this group" row; then one row per job
>      rendered with `idName(externalId, name)`.
>    - Clicking a left row only opens the right pane. Committing a scope is
>      "Show all …" (→ `setSelectedGroup`) or a job row (→ `setSelectedProject`),
>      which closes the popover. A ✓ marks the row matching the live scope.
>    - `useIsMobile()`: render one column instead, left pane first, and push to
>      the right pane with a "Back" button in its header.
>    - Rows are 32px, `rounded-sm px-2 text-sm`, active/highlighted rows use
>      `bg-accent text-accent-foreground`, counts use `tnum text-xs text-muted-foreground`,
>      section labels use `text-[11px] font-medium uppercase tracking-wide text-muted-foreground`.
> 3. Delete `components/job-groups-nav.tsx` and remove its import and
>    `<JobGroupsNav />` usage from `components/app-sidebar.tsx` (group
>    management now lives only in the selector and on `/job-groups`).
> 4. In `components/job-group-modal.tsx` add a search input above the jobs list
>    and above the people list, plus "N of M selected" / "N selected" counters.
>    Search must filter displayed rows only, never mutate the selection. Title
>    reads "Modify <name>" when editing, "New job group" otherwise.
> 5. Rewrite `app/(app)/job-groups/page.tsx` as two flex panes that wrap
>    (`flex flex-wrap` with `min-w`/`basis` so nothing gets pushed off screen):
>    the group list (name, "N jobs · N users", "New group") and the selected
>    group's jobs (search + a checkbox per job that calls
>    `projectGroup.setProjects` immediately, plus a "Modify group" button opening
>    the modal). Drop the old read-only "all projects" column and the
>    draft/Save-button flow. Show `EmptyState`/`ErrorNote`/`TableSkeleton` from
>    `components/sti/page` for the empty, error and loading states.
>
> Keep the repo's conventions: `"use client"`, `cn()`, lucide icons, semantic
> tokens only (no raw hex), a short comment block at the top of each file saying
> why the shape is what it is. Run `pnpm typecheck` and `pnpm lint` when done.
