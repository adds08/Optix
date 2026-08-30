# The reachability suite reads one sidebar and calls it the navigation

Three specs had been failing on `main` since 2026-08-23 19:58, and a fourth had
been passing for the wrong reason.

## What changed

`e2e/tests/reachability.spec.ts` no longer asks a single page load what
navigation a role is offered. `offeredRoutes` walks the rail — visiting each
group the permission filter left standing — and unions the sidebar hrefs it
finds. Both the expects and the forbids halves assert against that set.

`page.locator("main, body")` gained `.first()`.

## What was found while building it

**The suite was written against a sidebar that no longer exists.** It landed on
2026-08-22, when the sidebar listed every group at once. `3de9cda` changed it the
next day to render only the ACTIVE group's rows, which is the two-pane design —
the rail says which module, the sidebar says which screen. From `/home` the
Equipment group's rows are simply not in the DOM, so `owner should be offered
/tools` could never pass again. Redistributing the groups on 2026-08-24 did not
cause this and did not change its shape.

**The forbids half had gone vacuous, which is the worse half.** With one group
rendered, almost any forbidden href is absent regardless of what the permissions
say, so the assertion that catches a permission *widening* — the kind of bug
nobody reports, because nothing looks broken — had been passing for free since
the same commit. It is real again.

**`main, body` was a strict-mode violation reported as flakiness.** The shell
renders both `<body>` and the SidebarInset `<main>`, so the locator resolves to
two elements. It only failed some of the time because before hydration just
`body` matches: whether it passed depended on how fast the page settled.

**Waiting for `[data-sidebar]` to be visible is not waiting for the nav.** The
first attempt at the walk reported an owner — who can see everything — as being
offered exactly `/desk`, `/home`, `/old-dash` and `/settings/appearance`. Those
are precisely the four rows carrying no `perm`. Both panes filter against
`me.permissions`, which arrives from `identity.me` after first paint, so
collecting at that moment reads every gated group as forbidden. It looks exactly
like a permission bug and is not one. The walk now waits for `networkidle`,
which is the same signal the console-error spec in this file already uses.

## Verified

Full suite against the local Docker stack: 27 of 28 passing, run twice.

The one failure is `csv-export.spec.ts` and is a local database artifact, not a
regression: that spec needs the `needs-tag` report to be non-empty, and this
machine's database holds 0 untagged tools out of 754, so `report-table.tsx`
correctly suppresses the whole toolbar. CI seeds fresh and that spec passed
there in the same run these three failed.

## Deliberately not done

Nothing was changed in `apps/web`. The nav renders what it should; the test was
asking the wrong question.

`roles.ts` still expects `/settings` to be forbidden for warehouse, which holds:
that role lacks `config.manage`, so only the ungated Appearance row survives
inside the Settings group. Worth knowing that `/settings/appearance` IS offered
to them, by design.

## Where it is

Committed straight to `main` at Ashish's request, to put a green run on the
branch everything else merges into. Not deployed.
