import { test, expect } from "@playwright/test";
import { PASSWORD } from "../roles.js";

/*
  The first-run wizard's gate: who gets sent to /welcome, and who never does.

  This spec exists because the gate broke the entire browser suite once and
  nobody noticed. The wizard shipped, every account started landing on
  `/welcome`, and `auth.setup.ts` — which waits for each role's declared
  `landsOn` before saving a session — failed at the door. The suite was not run
  while the feature was being built, so the breakage sat there. A gate that
  decides where every single sign-in goes needs its own test.

  Signs in FRESH rather than reusing a stored session, unlike every other spec
  here. That is the whole point: the gate fires on the sign-in redirect, and a
  saved `storageState` lands you past the moment being tested.

  The rule under test, in one line: **you are sent to the wizard if you are on a
  job and have not finished it.** Not "if you have a login role", and not "if
  you have an employee record" — an equipment admin, a mechanic and the yard
  desk all have an employee record and no crew rows, because they serve every
  job rather than working on any, and a wizard whose first question is "which of
  your jobs is this about" has nothing to ask them.
*/

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in" }),
    "the web app did not serve a login page — is `make ENV=local up` running?",
  ).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/* `next dev` compiles a route on first hit, so the first case to reach a given
   destination pays for it — the same reason auth.setup.ts is generous. */
const ARRIVE = 45_000;

test.describe("first-run onboarding gate", () => {
  test("a superintendent on two jobs, not yet set up, lands on the wizard", async ({ page }) => {
    await signIn(page, "super@stinventory.local");
    await page.waitForURL((u) => u.pathname === "/welcome", { timeout: ARRIVE });

    /* Not merely the URL: the wizard has to actually render its first step for
       this to mean the person arrived somewhere usable. */
    await expect(page.getByRole("heading", { name: /Let's get you set up/ })).toBeVisible();
  });

  test("a foreman who already finished setup is never sent back", async ({ page }) => {
    /* The regression that broke the suite. `foreman@` is seeded onboarded, so
       the gate must stay out of the way and let the field redirect run. */
    await signIn(page, "foreman@stinventory.local");
    await page.waitForURL((u) => u.pathname === "/my-tools", { timeout: ARRIVE });
  });

  test("a mechanic on no jobs is never prompted", async ({ page }) => {
    /* Has an employee record, holds zero crew rows. Before the roster
       condition was added this account was sent through five empty steps to a
       finish that recorded nothing. */
    await signIn(page, "mechanic@stinventory.local");
    await page.waitForURL((u) => u.pathname === "/my-tools", { timeout: ARRIVE });
  });

  test("the yard desk is never prompted", async ({ page }) => {
    await signIn(page, "warehouse@stinventory.local");
    await page.waitForURL((u) => u.pathname === "/home", { timeout: ARRIVE });
  });

  test("an account with no employee record is never prompted", async ({ page }) => {
    /* owner@ has no employee row at all — the older half of the same rule. */
    await signIn(page, "owner@stinventory.local");
    await page.waitForURL((u) => u.pathname === "/home", { timeout: ARRIVE });
  });

  test("skipping is recoverable, and does not fire the gate twice", async ({ page }) => {
    /*
      Two properties in one journey, because they are the same decision: the
      gate is a NUDGE, not a wall. Skipping must let the person get on with
      their work, and must still leave a way back — a skip that stranded the
      wizard with no route to it is what `dismissedAt` and the sidebar notice
      were added for.
    */
    await signIn(page, "super@stinventory.local");
    await page.waitForURL((u) => u.pathname === "/welcome", { timeout: ARRIVE });

    await page.getByRole("button", { name: "Skip setup" }).click();
    await page.waitForURL((u) => u.pathname !== "/welcome", { timeout: ARRIVE });

    /* The notice is the way back, and it must be visible from a normal screen
       rather than only on the one the skip happened to land on. */
    const notice = page.getByRole("button", { name: /Finish your setup/ });
    await expect(notice).toBeVisible({ timeout: 15_000 });

    await notice.click();
    await page.waitForURL((u) => u.pathname === "/welcome", { timeout: ARRIVE });
    await expect(page.getByRole("heading", { name: /Let's get you set up/ })).toBeVisible();
  });
});
