---
name: test-on-playwright
description: Drive the running STInventory stack in a real browser — run or write a spec in `e2e/`, or steer the live app through the Playwright MCP. Use whenever a change has to be SEEN working rather than argued for: "test this in the browser", "run the e2e suite", "click through it", "take a screenshot", "is this screen reachable", "does this work as a foreman", or any UI regression, layout or permission question. Use ESPECIALLY before claiming a feature is delivered — a procedure with no screen that opens it is not delivered.
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

## Two tools. Pick deliberately, and say which you used

| | The committed suite (`e2e/`) | The Playwright MCP |
|---|---|---|
| What it is | `@stinventory/e2e`, real specs, `make ENV=local e2e` | You driving a live browser, tool call by tool call |
| Use it for | Behaviour that must never regress; anything a future refactor could silently break | Exploring, reproducing a bug, one-off "does this actually work", screenshots for a human |
| Survives the session | Yes — that is the whole point | No. Nothing is recorded |
| Costs | A spec somebody else has to keep green | Nothing, until you claim its result as coverage |

The trap is claiming the second as the first. "I drove it in the browser and it worked"
is evidence for *this* change and coverage for nothing. If the behaviour must hold
tomorrow, it needs a spec.

## Before anything: the stack must be up

```bash
make ENV=local up          # web :3100, api :4100, postgres
make ENV=local seed        # if the data looks empty or wrong
curl -s http://localhost:4100/health
make ENV=local e2e-install # once per machine — fetches Chromium
make ENV=local e2e         # the suite, from OUTSIDE the containers
```

`make ENV=local e2e` runs `pnpm --dir e2e exec playwright test` on the host, deliberately
**not** inside the api container: the container has no browser, and a suite that talks to
the stack from outside is the only kind that tests the stack rather than a process's
opinion of itself.

Run one spec while iterating: `pnpm --dir e2e exec playwright test tests/nav-pins.spec.ts`.
Add `--ui` for the inspector, `--headed` to watch it.

## The rules that were each bought with a failure

**1. Playwright never boots a server.** `webServer` is absent from
`e2e/playwright.config.ts` on purpose. A Playwright-launched `next dev` is a different
build with different env and no API behind it. If nothing is listening, the suite fails
fast with a readable message — that message means "start the stack", not "raise the
timeout".

**2. Auth is captured once per role, never typed in a spec.** The `setup` project logs in
each account in `e2e/roles.ts` and saves `storageState` to `.auth/<role>.json`; specs
depend on it. Do not write a login into a spec, and never fake a session or stub
permissions — that asserts your mock, not the system. Need a role that has no account?
That is itself a finding; report it rather than working around it.

**3. Every existing spec is READ-ONLY, and that is load-bearing.** It is what lets
`fullyParallel` run against one shared database with no isolation mechanism. **The first
mutating spec needs isolation chosen first, not afterwards** — read the isolation note at
the top of `e2e/playwright.config.ts` before you write one. Two constraints are already
established and should not be re-derived: per-test transaction rollback is unavailable
(the server owns the connection across the HTTP boundary), and truncating `transaction`
requires disabling the append-only trigger from `packages/db/drizzle/0014_append_only_ledger.sql`.

**4. Assert the database as well as the screen.** After any mutating journey:

```bash
make ENV=local psql
```

Check the projection *and* the ledger row — `to_state` must be a **complete** snapshot
(custodian, project, location, status), because `foldAssetState` replaces rather than
merges. Assert exactly one active `assignment` after a transfer. A journey verified only
by what the UI rendered has not been verified.

**5. Never `networkidle`.** The shell polls `dashboard.notifications` on an interval and
the desk pages hold live queries, so "the network was quiet for 500ms" is a state this
app reaches late or never. The same suite that runs in ninety seconds took **twenty-two
minutes** with `networkidle` and still failed. Wait on the condition that actually means
your data arrived — the account button appears only once `identity.me` resolves, which is
the same fact the nav filter waits on. See
`.claude/skills/systematic-debugging/condition-based-waiting.md`.

**6. Assert the contract, not the copy.** Sidebar checks read `href`s from the DOM, not
link text: "Users" became "User Accounts" during Phase 3 and would have broken every one
of them for no reason. Prefer roles and hrefs; a test that fails when somebody improves a
word teaches people to stop reading it.

**7. Read hrefs from the DOM, never from the config the code uses.** A spec that imports
`nav-config.ts` proves the file parses. And the shell is two panes — the rail picks the
module, the sidebar lists only that module's screens — so "what is this role offered" is
the union across every rail group. Asking `/home` alone once reduced a permission-widening
assertion to something that passed vacuously.

**8. Test the negative half.** A missing link is a bug somebody reports; an extra one is a
permission leak nobody notices until it is used. `forbidsRoutes` in `e2e/roles.ts` is the
half that catches a widening.

**9. Artefacts are never committed.** `test-results/`, `playwright-report/`, `e2e/.auth/`,
traces, videos, screenshots, and the `.playwright-mcp/` console logs the MCP drops at the
repo root. All gitignored — keep it that way, and **stage files by name** so a stray one
never rides along.

## Writing a new spec

1. **Name what regression it prevents**, in the file's header comment, in the style the
   existing specs use — the specific bug, not "tests the nav". A spec whose reason is
   unstated gets deleted the first time it goes red.
2. Put it in `e2e/tests/*.spec.ts`. Use `authFile(role)` for `storageState`; add the role
   to `e2e/roles.ts` if it is missing.
3. **Prove it can fail.** Break the behaviour, watch it go red, restore it, watch it go
   green. A spec that passes whether or not the feature exists reads as coverage and is
   worse than none.
4. `pnpm --dir e2e exec typecheck` — the suite is typechecked like everything else.
5. If it mutates, rule 3 applies before anything else.

## Driving the live app through the MCP

Use `browser_navigate` → `browser_snapshot` → act. Sign in at `http://localhost:3100` with
an account from `e2e/roles.ts`; the password is in the same file.

- Prefer `browser_snapshot` over `browser_take_screenshot` for deciding what to click —
  it is the accessibility tree, it is cheap, and it gives you the refs. Screenshot when a
  **human** needs to see it, or when the question is visual (alignment, overflow, shift).
- Check `browser_console_messages` and `browser_network_requests` after a journey. This UI
  swallows errors silently; a 403 that renders as an empty table looks like "no data".
- Test at more than one width if the question is layout. The table system freezes columns
  and the shell collapses; both have regressed at sizes nobody opened.
- After every mutating action, go to `psql`. Same rule as the suite — the MCP does not
  earn an exemption.

## When a spec goes red

Invoke `systematic-debugging`. Two things specific to here before you start:

- **The browser suite is not in CI.** The `e2e` job was removed from
  `.github/workflows/ci.yml` on 2026-08-30 (`docs/tickets/make-the-browser-suite-blocking.md`,
  STI-122). It was never in `deploy.needs`, so nothing it says has ever blocked a merge.
  A red spec today may predate your branch — check `git log` on the spec and on what it
  covers before assuming you caused it.
- **Three specs were red when the job was removed**: `nav-pin-order.spec.ts`,
  `nav-pins.spec.ts`, and `nav-feature-flags.spec.ts` (flaky). Two of them seed the
  `sti-pins` storage key with module ids and the commit before the failing run scoped pins
  to their module — the suite was doing its job. Verify current state by running it; do
  not repeat that list as fact.

A spec that is flaky is not a spec that needs a retry. It is a condition you are waiting
on wrongly — see rule 5.

## Finishing

- Say which tool you used and what you actually observed. "The suite passes" needs the
  output; "I clicked through it" needs the journey and the database rows.
- If you changed anything under `e2e/`, that is a diff — invoke the `changelog` skill
  before reporting done.
- Related: `.claude/rules/web.md` for the web app's own rules, `.claude/agents/sti-e2e-qa.md`
  for the per-phase acceptance pass, `docs/tickets/e2e-critical-paths.md` for the mutating
  custody journeys that are specified but not yet written.
