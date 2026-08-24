import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/*
  STI-1102 — the database suites must actually run in CI.

  Every DB-backed suite in this package opens with
  `describe.skipIf(!process.env.DATABASE_URL)`, which is right for a laptop
  with no stack up: a developer running `pnpm test` gets the pure suites and no
  connection errors.

  In CI it was a hole. The `check` job ran `pnpm test` with no Postgres service,
  so **178 of 245 tests skipped and the job reported success** — custody,
  tenant-scoped login, ledger append-only, project scope and the RBAC matrix
  among them. That is the exact set this workflow's header says nothing reaches
  main without. The suites were not broken; they were not running, which is
  worse, because a skip prints as a pass at a glance.

  A skip is invisible by construction — vitest exits 0 and there is nothing to
  assert on afterwards. So the check has to be a test of its own, and it has to
  key on something CI sets and a laptop does not.
*/

const SRC = new URL("./", import.meta.url).pathname;

/* The guard string every DB-backed suite in this package uses. Counted from
   source rather than hardcoded, so adding a suite cannot make this stale. */
const GUARD = "describe.skipIf(!url)";

function dbBackedSuites(): string[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith(".test.ts"))
    .filter((f) => readFileSync(SRC + f, "utf8").includes(GUARD));
}

describe("the database suites run where they are supposed to", () => {
  /*
    Not `it.skipIf` — this one must run everywhere, because the thing it is
    guarding against is a suite that stops running.
  */
  it("has a DATABASE_URL whenever CI is set", () => {
    if (!process.env.CI) return; // a laptop with no stack up: nothing to prove

    expect(
      process.env.DATABASE_URL,
      "CI is set but DATABASE_URL is not, so every DB-backed suite in this " +
        "package will skip and the job will still report success. Give the " +
        "job a postgres service — see .github/workflows/ci.yml `check`.",
    ).toBeTruthy();
  });

  /*
    The counterpart. If somebody replaces the guard with a different spelling,
    the check above still passes while the suites it protects quietly stop
    being protected. Asserting the guard is still in use keeps the two honest.
  */
  it("finds the suites it is protecting", () => {
    expect(
      dbBackedSuites().length,
      `No file in this package uses \`${GUARD}\`. Either the DB-backed suites ` +
        "were removed, or the guard was respelled and this test no longer " +
        "knows what it is watching. Update GUARD here in the same change.",
    ).toBeGreaterThan(0);
  });
});
