# Every dropdown is the same dropdown

The web app rendered two kinds of dropdown. Most forms used a native `<select>`, which draws
the operating system's own widget — so the same form looked like macOS on one desk and
Windows on another, next to shadcn controls that looked like neither. A few screens used the
app's own picker. Nothing decided which; it was whichever the file had been written with.

All of them are now the app's picker.

## What changed

Thirty-five native `<select>` elements across eighteen files became `EntityField`
(`components/ui/entity-picker.tsx`). `grep -rn '<select' apps/web --include='*.tsx'` now
returns comments and nothing else.

**Including the short lists.** Employment status has three options and vehicle type has two;
neither needs a search box. They were converted anyway, because the alternative rule is
"searchable where the list is long", and a control that changes shape depending on how much
data a tenant happens to have is a control nobody can describe. One picker, everywhere, is
the only version of this that stays true.

`EntityField` gained a `disabled` prop. The module-settings dropdown fires a mutation on
change and must not accept a second pick while the first is in flight — a native `<select>`
had that for free, and replacing it must not quietly lose it.

Two now-dead class constants went with the elements they styled, and the comments on the
picker that described the conversion as partial were brought current.

`.claude/rules/web.md` gains the rule, because that is the file an agent reads before
touching `apps/web` and a convention nobody wrote down is a convention that lasts until the
next form.

## What was found while building it

**There are two components called `EntityField`.** One in `components/ui/entity-picker.tsx`
picks from a list the caller already holds; one in `components/entity-field.tsx` searches the
whole tenant over `entity.search` and never loads a list at all. Both are needed and they
answer different questions — the second is what makes a four-hundred-tool picker possible
without fetching four hundred rows to filter client-side.

`resolve-message.tsx` needs both, and importing the second on top of the first is what
surfaced the clash. It fails as a duplicate-identifier type error rather than as a component
that misbehaves, which is the good version of this problem, but it is still a trap: the file
now aliases one and says why. Renaming either would reach a dozen call sites to fix a
collision that happens once.

**The intent rule was stale in a way that mattered.** `.claude/rules/intent.md` stated
`CUSTODIAN_ROLES` as "(`foreman`, `mechanic`)" — a copy of a list that gained
`superintendent` earlier the same day. That is the failure mode CLAUDE.md rule 9 describes:
every agent is told to read `.claude/rules/` before touching an area, so a wrong list there
misleads every future change. It now names the source file instead of copying its contents,
which is the only version that cannot go stale again.

## Verified

`pnpm typecheck` clean across the workspace and `eslint` clean in `apps/web` — which is what
catches a mis-shaped `options` array, since every conversion had to map a different source
of rows into `{ value, label, hint }`.

`turbo run test` green in every package, run inside the api container so the database-backed
suites executed rather than skipping.

The rule written into `.claude/rules/web.md` claims the grep returns only comments; that grep
was run after writing it, and all eight remaining hits are prose.

**Not verified:** no screen was opened in a browser. This is a wide, mechanical diff across
eighteen forms, and typecheck proves the option lists are well-formed, not that every
dropdown opens where it should sit. Worth a click through the register forms.

## Deliberately not done

**`SearchSelect` was left as it is.** It is already built on the same picker and keeps one
behaviour of its own on purpose: picking the already-selected option clears it, because a
filter needs "show me everything again" without a separate reset button.

**Neither `EntityField` was renamed.** The alias costs one line in one file; a rename costs a
dozen call sites.

**The historical comments were kept.** `transfer-form.tsx` still describes what the old
`<select>` looked like, because it explains why the code before/after decision was made, and
that reasoning is still load-bearing.

## Where it is

Branch `feat/searchable-dropdowns`, stacked on `feat/jobsites-crew-controls` (#30) rather
than on `main`. That branch converts the last `<select>` in `assign-form.tsx` as part of its
own fix, so basing this on `main` would have left two PRs editing the same lines and a
conflict to resolve by hand. Stacked, the sweep is complete and the rebase was clean.

**Not deployed.**
