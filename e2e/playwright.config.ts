import { defineConfig, devices } from "@playwright/test";

/*
  The browser suite (STI-001).

  Why it exists, in one sentence: six backend procedures once had no UI caller,
  which is how the desk approval queue — a fully built second-signature gate —
  became something no screen could open, and nothing automated would have
  noticed. `SYSTEM_PLAN.md` §9 makes reachability the acceptance standard, and
  until now the only thing enforcing it was somebody going to look.

  ## It does NOT boot a server

  `webServer` is deliberately absent. The stack under test is the Docker one —
  web on :3100 talking to api on :4100 talking to Postgres — and a
  Playwright-booted `next dev` would be a different program with a different
  build, different env and no API behind it. Run `make ENV=local up` first;
  the suite fails fast with a readable message if nothing is listening.

  ## Database isolation — the decision STI-001 asks for, made explicitly

  STI-001 proposes a template-database restore per worker
  (`CREATE DATABASE ... TEMPLATE stinventory_seed`) and says to VALIDATE it
  before committing, because it is a design proposal rather than received
  wisdom.

  **Validated, and not adopted yet — because this suite does not need it.**
  Every spec here is read-only: it signs in, navigates, and asserts what is on
  the screen. Nothing it does changes a row, so two workers cannot interfere
  and a re-run cannot see the previous run's leftovers. Building a
  per-worker database restore to protect reads would be machinery in place of a
  reason.

  What that costs is precision about when it stops being true: **the first
  mutating spec needs an isolation mechanism first, not afterwards.** That is
  STI-002's opening problem and is written into that ticket rather than left
  for somebody to discover when two workers start fighting over TOOL-0001.
  The two constraints already established still hold and should be read before
  choosing: per-test transaction rollback is unavailable because the server
  owns the connection across the HTTP boundary, and truncating `transaction`
  requires disabling the STI-104 append-only trigger.

  ## Auth

  A `setup` project captures one `storageState` per role, and the specs depend
  on it. Not `globalSetup`: project dependencies get retries, traces and
  reporting like any other test, so a broken login shows up as a failed setup
  rather than an unexplained cascade of failures in every spec.
*/

const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./tests",
  /* The stack is shared, so a spec that depends on another spec's leftovers
     would pass alone and fail in CI. Fully parallel makes that break loudly. */
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /* One worker locally so a failing run is readable; CI parallelises. */
  workers: process.env.CI ? 4 : 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: WEB,
    /* Artefacts only on failure — a green run should leave nothing behind. */
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "setup", testDir: "./setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
});
