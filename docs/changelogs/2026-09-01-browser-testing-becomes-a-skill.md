# Browser testing becomes a skill, in both harnesses

The browser suite in `e2e/` carries its reasoning in header comments — the isolation
note in `playwright.config.ts`, the two-pane nav explanation in `reachability.spec.ts`,
the `networkidle` post-mortem. All of it is excellent and none of it is reachable
before you have already opened the file you were about to get wrong. Nothing told an
agent asked to "check this in the browser" that the suite is read-only on purpose, that
`networkidle` once turned a ninety-second run into twenty-two minutes, or that a green
screen is not evidence in an event-sourced system.

There was also no single answer to "which browser tool" — the committed suite and the
Playwright MCP are different instruments with different guarantees, and treating a live
MCP walkthrough as coverage is the specific mistake worth naming.

## What changed

### `.claude/skills/test-on-playwright/SKILL.md` — new

A skill covering both instruments. It opens with the decision table (committed spec
versus live MCP, and what each is and is not evidence for), then the commands to get
the stack up, then nine rules that were each already paid for by a failure in this
repo:

- Playwright never boots a server — `webServer` is absent deliberately.
- Auth is captured per role by the `setup` project; specs never type a login and never
  stub a permission.
- The suite is read-only, and that is what lets it run parallel against a shared
  database. **The first mutating spec chooses isolation first** — with the two
  established constraints restated so they are not re-derived.
- Assert the ledger row and the complete `to_state`, not the screen.
- Never `networkidle`; wait on the condition that means the data arrived.
- Assert hrefs and roles, not copy, and read them from the DOM rather than from
  `nav-config.ts`.
- Test `forbidsRoutes` too — an extra link is the failure nobody reports.
- Never commit `test-results/`, `playwright-report/`, `e2e/.auth/` or `.playwright-mcp/`.

Then a procedure for writing a spec (including proving it can fail), the MCP workflow
(`browser_snapshot` over screenshots for deciding what to click; console and network
after every journey), and what to check first when a spec is red.

### `.kilo/skills/urban-test-on-playwright/SKILL.md` — new

Kilo port, following the convention the four existing ports already use: same content,
`urban-` prefix, a paragraph saying where the original lives. Three references are
repointed — `urban-systematic-debugging` and its `condition-based-waiting.md`, and the
changelog step, which points at `.claude/skills/changelog/SKILL.md` because that skill
has no Kilo port.

`.kilo/` is gitignored (`.gitignore:20`), so this copy exists on this machine and is
**not in the repository**. Anyone cloning fresh gets the Claude skill only.

### `CLAUDE.md` — one row in the skills table

Between `visual-explainer` and `/feature-delivery`. Without it the table was the list
of skills, and a skill absent from the list is a skill nobody invokes.

## What was found while building it

**The e2e job's removal is recent enough to mislead.** It came out of
`.github/workflows/ci.yml` on 2026-08-30 with three specs red, and it was never in
`deploy.needs`, so nothing it ever said blocked a merge. An agent running the suite
today can therefore meet failures that predate its branch. The skill says to check
`git log` before assuming authorship, and names the three specs while explicitly
telling the reader to re-run rather than repeat the list as fact — the two pin specs
were red because a commit scoped pins to their module and invalidated a flat list of
module ids in `sti-pins`, which is the suite working, not failing.

**There is no `changelog` port in `.kilo/skills/`.** Four of the five Claude skills
have Kilo copies; that one does not. Not fixed here — it is a separate change, and
copying a skill nobody asked for is exactly the "while I'm in here" this repo's rule 4
forbids.

## Verified

- `git status --porcelain` — `M CLAUDE.md`, `?? .claude/skills/test-on-playwright/`.
- `git check-ignore -v .kilo/skills/urban-test-on-playwright/SKILL.md` → `.gitignore:20:.kilo/`,
  which is how the "not in the repository" claim above was established rather than assumed.
- `diff` between the two SKILL.md copies — five hunks, all of them the intended
  frontmatter, port note and repointed references.
- The Claude harness picked the skill up and listed it by name and description in the
  same session, so the frontmatter parses and it is discoverable.

**Not verified:** the suite was not run, and no browser was opened. This change adds no
spec and touches nothing under `e2e/`, so there was nothing new to execute — every
command and file path in the skill was read out of the tree (`Makefile:106-114`,
`e2e/playwright.config.ts`, `e2e/roles.ts`, `.gitignore`) rather than recalled, but the
skill's own instructions have not been walked end to end by anyone. **Kilo has not been
started against its copy**; the port follows the existing convention and that is the
whole of the evidence for it.

## Deliberately not done

- **No new spec.** The mutating custody journeys in `docs/tickets/e2e-critical-paths.md`
  still need an isolation mechanism chosen before they can be written; the skill points
  at that ticket rather than pre-empting it.
- **The red specs were not fixed.** STI-122 owns that, and it is not a documentation task.
- **No `changelog` Kilo port**, as above.
- **The skill was requested as `test-on-playwrite`** and is spelled `test-on-playwright`,
  because the name is a tool's name and a permanent typo in a slug is expensive to
  correct later.

## Where it is

Uncommitted on `main` at the time of writing: `CLAUDE.md` modified, the Claude skill
untracked, the Kilo copy outside version control by design. Not deployed — nothing here
ships.
