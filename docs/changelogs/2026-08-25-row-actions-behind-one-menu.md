# Row actions move behind one menu

The actions cell on People and Projects held a strip of buttons — "Move
project", Edit, a delete bin — laid out inline. It did not fit. The trailing
control was clipped by the cell, which on People meant the delete bin was
simply unreachable at ordinary window widths.

Widening the column is what had already been tried, twice, and the comment left
behind records it: People went from `9rem` to `14rem` when "Move project"
arrived, Projects sat at `10rem` because at `3rem` the buttons "overflowed the
cell and their opaque backgrounds covered the status pill next door". It does
not converge. The column ends up sized for the widest row's worst case, and
every action added takes width from the data people came to read.

## What changed

### `RowActions` is a menu, not a strip

`apps/web/components/sti/row-actions.tsx` now renders one ellipsis trigger with
the actions inside it. A trigger is a fixed width no matter how many actions
hang off it, which is the property the strip never had.

This is deliberately not a new pattern. `ToolMenu` reached the same conclusion
for tools some time ago — its header makes the argument, against a hover-only
button strip — so this is that component in miniature: the same ellipsis
trigger, the same armed confirmation, the same danger styling. A row in the
register and a row in People should not answer the same gesture differently.

### `extra` becomes `actions`

The prop took a `ReactNode` and each page passed a rendered `<Button>` wrapped
in its own `<Can>`. That is why the strip could not simply be moved into a menu:
JSX can be placed somewhere else, but it cannot be turned into a menu item.

It now takes `RowAction[]` — `{ label, icon, onSelect, perm? }` — and this file
decides how they render. The permission gate stops being something each caller
remembers to wrap around its own button, and People drops its `Can` and `Button`
imports entirely.

### The columns shrink

`14rem` → `4rem` on People, `10rem` → `4rem` on Projects. Both comments are
rewritten, because both described a layout that no longer exists — and the
Projects one specifically justified its width by the "Keep / Delete" pair the
old inline confirmation swapped in, which now happens inside the menu where
nothing changes width.

## What was found while building it

- **The pattern already existed and one component had not adopted it.**
  `ToolMenu` (used by the tools register, `3.5rem` actions column) had been a
  menu for a while. `RowActions` was the outlier. The fix was to reach for the
  existing answer, not to design one.

- **The failure mode was invisible to whoever added the action.** Adding "Move
  project" to People pushed the delete bin out of the cell, and the natural
  response — widen the column — looked like it worked at the width the author
  had open. Nothing about the strip fails loudly at any particular size.

- **A cell with no available actions used to render an empty control.** The old
  component always drew its wrapper and let `Can` empty it out. The menu returns
  `null` when the caller has no rights and no actions, because an ellipsis that
  opens an empty menu advertises something that is not there.

- **`sonner` is installed but used by nothing** — no `toast()` call anywhere in
  the app, and no mounted `Toaster`. It looked like the obvious home for the
  server's delete refusal; it is not an established pattern here, so the
  refusal stays in the cell, narrower and wrapping.

## Verified

- `pnpm typecheck` — 14 tasks successful.
- `pnpm lint` — 0 errors. `npx eslint` over the three changed files
  specifically: clean, no new warnings (the app carries a pre-existing warning
  backlog, none of it in these files).
- `/people`, `/projects` and `/tools` all compile and serve 200, with no
  compile errors in the web container.
- Every actions column in the app was enumerated (`grep 'id: "actions"'`) rather
  than assumed: tools already used `ToolMenu`, custody is discussed below, and
  the two fixed here were the rest. No other table cell renders more than one
  button.

**Not verified: none of this has been seen rendered.** The tables are behind
authentication and no browser tooling was available in the session that made the
change, so "the trigger fits in 4rem" is arithmetic — `size-7` is 28px inside
64px — rather than an observation. The menu contents, the armed delete
confirmation and the refusal message all need a look before this is called done.

## Deliberately not done

- **Custody's Approve / Decline is left as two buttons.** It is the only other
  table cell with more than one control, and it is not the reported problem —
  two short labels in a `12rem` column are not clipped. More to the point, that
  screen is an approval queue: burying its primary action behind a menu makes
  the desk's main job two clicks instead of one. Worth changing only if somebody
  asks for it.
- **Panel headers keep their buttons.** `admin/roles` (Save changes, Delete) and
  `job-groups` ("Modify group") both matched a search for row actions but are
  section headers, not table rows. A primary Save behind an ellipsis would be a
  regression.
- **No test.** `apps/web` still has no test harness, unchanged from the three
  entries before this one.

## Where it is

Committed on `development`. Not pushed and not deployed; production remains four
commits behind `main`, and the CI seed fix in `940c388` has to land before
anything can deploy.
