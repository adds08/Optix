import { test as setup, expect } from "@playwright/test";
import { ROLES, PASSWORD, authFile } from "../roles.js";

/*
  Sign in once per role and keep the session.

  A `setup` project rather than `globalSetup` (STI-001 criterion 6): project
  dependencies are ordinary tests, so they get retries, traces and a place in
  the report. A login that breaks shows up as one failed setup instead of every
  spec failing for reasons the report cannot explain.

  The captured files hold real session tokens for the seeded accounts and are
  gitignored. They are regenerated on every run — treating them as a cache is
  how a suite starts passing against a session that no longer reflects the
  account's permissions.
*/
for (const role of ROLES) {
  setup(`authenticate as ${role.key}`, async ({ page }) => {
    await page.goto("/");

    /* Fail here with something readable if the stack is not up, rather than
       twelve specs timing out on a connection refused. */
    await expect(
      page.getByRole("heading", { name: "Sign in" }),
      "the web app did not serve a login page — is `make ENV=local up` running?",
    ).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Email").fill(role.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    /* The shell decides where a role lands, so this assertion is load-bearing:
       a foreman arriving at /home would mean the field redirect regressed.

       The timeout is generous because the stack under test is `next dev`, which
       compiles a route on its first hit. The two roles that flaked here — the
       foreman and the mechanic — are exactly the two that land on `/my-tools`,
       so one of them always paid for that route's first compile and 15s was
       occasionally not enough. Read a failure here as "the redirect is wrong",
       not "the machine was slow", which is only true because of this line. */
    await page.waitForURL((url) => url.pathname === role.landsOn, { timeout: 45_000 });

    await page.context().storageState({ path: authFile(role.key) });
  });
}
