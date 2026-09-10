---
name: test-on-playwright
description: Drive the running STInventory stack in a real browser through the Playwright MCP. Use whenever a change has to be SEEN working rather than argued for: "test this in the browser", "click through it", "take a screenshot", "is this screen reachable", "does this work as a foreman", or any UI regression, layout or permission question. Use ESPECIALLY before claiming a feature is delivered — a procedure with no screen that opens it is not delivered.
---

# Test on Playwright

## Why this exists

Six backend procedures once had no UI caller. That is how the desk approval queue — a
fully built second-signature gate — became something no screen could open, and nothing
automated noticed for weeks. `SYSTEM_PLAN.md` §9 makes reachability the acceptance
standard: **a task is done when a person with the right role can sit at the desk and
complete it.** A source grep cannot see a route that 500s, a control behind a
permission that silently widened, or a table that only breaks at 1280px. A browser can.

The counterpart failure is a green screen. This is an event-sourced system; the screen
renders `asset.current_*`, which is a projection. A journey that looks right and wrote a
partial `toState` has shipped three times. **The row is the evidence, not the pixel.**

## There is no committed browser suite

**The `e2e/` Playwright suite was DELETED on 2026-09-10**, at the user's request, along
with its `make e2e` / `make e2e-install` targets, the `pnpm e2e` script and its
workspace entry. It had drifted from the UI — specs still clicking an "In Yard" tab
renamed to "Yard", and asserting a "TAG" column renamed to "CODE" — and stale specs that
name screens which no longer exist are worse than no specs, because an agent reads them
as fact.

So: **this skill is the MCP only.** There is nothing to run, no `.spec.ts` to add, no
`roles.ts` to import. If a doc, ticket or plan tells you to run `make e2e`, add a spec
under `e2e/tests/`, or read `e2e/playwright.config.ts`, it is describing deleted code —
say so rather than recreating it. Do not reintroduce a spec suite without the user
explicitly asking for one.

What that costs, stated honestly: **nothing here survives the session.** Driving the
browser is evidence for *this* change and coverage for nothing. Never report it as
regression protection.

## Before anything: the stack must be up

```bash
make ENV=local up            # web :3100, api :4100, postgres
make ENV=local seed-demo     # the fixture with one account per role
curl -s http://localhost:4100/health
```

Use `seed-demo`, not `seed-urban`, when you need a specific role: the demo fixture is
the one carrying an account per permission tier. `seed-urban` has two logins only.

**Sign-in is at `/` — there is no `/login` route.** Password `stinventory-demo` for
every demo account. The accounts are listed in `docs/SETUP.md`; that table is the
surviving source now that `e2e/roles.ts` is gone.

Two seeded accounts land on `/welcome` rather than their normal screen, because the
first-run wizard gate is unfinished for them — `mechanic@` and `super@`. That is the
gate working, not a bug. Everyone else lands on `/home`, except field roles
(`foreman@`), which the shell redirects to `/my-tools`.

## The rules that were each bought with a failure

**1. Never wait on `networkidle`.** The shell polls notifications on an interval and the
desk pages hold live queries, so "the network was quiet for 500ms" is a state this app
reaches late or never. Wait on the condition that actually means your data arrived — the
account button appears only once `identity.me` resolves, which is the same fact the nav
filter waits on. See `.claude/skills/systematic-debugging/condition-based-waiting.md`.

**2. Assert the database as well as the screen.** After any mutating journey:

```bash
make ENV=local psql
```

Check the projection *and* the ledger row — `to_state` must be a **complete** snapshot
(custodian, project, location, status), because `foldAssetState` replaces rather than
merges. Assert exactly one active `assignment` after a transfer. A journey verified only
by what the UI rendered has not been verified. The MCP earns no exemption from this.

**3. Assert the contract, not the copy.** Read `href`s and roles, not link text.
"Users" became "User Accounts" during Phase 3; "In Yard" became "Yard" and "TAG" became
"CODE", which is what killed the old suite. A check that breaks when somebody improves a
word teaches people to stop reading it. **Verify a label against the live DOM before you
assert it** — that habit is exactly what the deleted specs lacked.

**4. Check the negative half.** A missing link is a bug somebody reports; an extra one is
a permission leak nobody notices until it is used. Sign in as a role that should be
refused and confirm it is — the API answers `403 missing permission: <name>`, and the
sidebar must not offer the route at all.

**5. The shell is two panes.** The rail picks the module, the sidebar lists only that
module's screens — so "what is this role offered" is the union across every rail group.
Asking `/home` alone once reduced a permission-widening check to something that passed
vacuously.

**6. Artefacts are never committed.** The `.playwright-mcp/` console logs the MCP drops
at the repo root, plus any screenshots. Gitignored — keep it that way, and **stage files
by name** so a stray one never rides along.

## Driving the live app

Use `browser_navigate` → `browser_snapshot` → act.

- Prefer `browser_snapshot` over `browser_take_screenshot` for deciding what to click —
  it is the accessibility tree, it is cheap, and it gives you the refs. Screenshot when a
  **human** needs to see it, or when the question is visual (alignment, overflow, shift).
- Check `browser_console_messages` and `browser_network_requests` after a journey. This UI
  swallows errors silently; a 403 that renders as an empty table looks like "no data".
- Test at more than one width if the question is layout. The table system freezes columns
  and the shell collapses; both have regressed at sizes nobody opened.

## When something is red

Invoke `systematic-debugging`. One thing specific to here: the app is `next dev`, which
compiles a route on its first hit, so the first navigation to a screen is genuinely slow.
That is a reason to wait on a condition (rule 1), never a reason to raise a timeout and
call it fixed.

## Finishing

- Say what you actually observed — the journey you walked and the database rows you
  checked. Never imply it is durable coverage; see the note above.
- If you changed anything, that is a diff — invoke the `changelog` skill before
  reporting done.
- Related: `.claude/rules/web.md` for the web app's own rules,
  `.claude/agents/sti-e2e-qa.md` for the per-phase acceptance pass (which also drives the
  MCP, not a suite), `docs/SETUP.md` for the seeded accounts.
