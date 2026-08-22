import { test, expect } from "@playwright/test";
import { ROLES, authFile } from "../roles.js";

/*
  The smoke suite (STI-001 criterion 7), and the shape STI-002 extends.

  Every spec here is READ-ONLY — see the isolation note in
  `playwright.config.ts`. Nothing below changes a row, which is what lets the
  suite run in parallel against a shared database without an isolation
  mechanism. The first mutating spec needs one first.

  What this is actually guarding. The desk approval queue was fully built and
  unreachable for weeks because nothing checked that a screen could open it.
  `reachability.test.ts` now catches a procedure with no CALLER, but a caller
  behind a broken route, a crashing page or a permission that silently widened
  is invisible to a source grep. This is the half that needs a browser.
*/

for (const role of ROLES) {
  test.describe(`as ${role.key}`, () => {
    test.use({ storageState: authFile(role.key) });

    test("lands on the right screen and it renders", async ({ page }) => {
      await page.goto(role.landsOn);
      await expect(page).toHaveURL(new RegExp(`${role.landsOn}$`));

      /* Next.js renders an error boundary rather than a blank page when a
         client component throws, so "did it crash" is a real assertion and not
         a proxy for one. STI-304 criterion 4: a role that logs in to a crash
         is not delivered. */
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
      await expect(page.locator("main, body")).toBeVisible();
    });

    /* The sidebar is not a <nav> — shadcn builds it from divs carrying
       `data-sidebar`. Scoped to that rather than to the whole page, so a link
       in the page BODY (the dashboard links to /reports/idle, for instance)
       cannot make a forbidden route look offered. */
    const sidebarLink = (page: import("@playwright/test").Page, href: string) =>
      page.locator(`[data-sidebar] a[href="${href}"]`);

    test("is offered the navigation its permissions imply", async ({ page }) => {
      await page.goto(role.landsOn);
      await expect(page.locator("[data-sidebar]").first()).toBeVisible({ timeout: 10_000 });

      for (const href of role.expectsRoutes) {
        await expect(
          sidebarLink(page, href),
          `${role.key} should be offered ${href}`,
        ).toHaveCount(1);
      }
    });

    test("is NOT offered navigation its permissions forbid", async ({ page }) => {
      await page.goto(role.landsOn);
      await expect(page.locator("[data-sidebar]").first()).toBeVisible({ timeout: 10_000 });

      for (const href of role.forbidsRoutes) {
        await expect(
          sidebarLink(page, href),
          `${role.key} must NOT be offered ${href}`,
        ).toHaveCount(0);
      }
    });

    test("loads without a console error", async ({ page }) => {
      /*
        A page can render and still be broken: HR's dashboard used to fire four
        403s per load because the panels were hidden but their queries were
        not. That is invisible to a screenshot and to every assertion above,
        and it is how a real error stops being findable among the expected
        ones.

        Filtered to genuine page errors — a missing favicon is not a defect and
        failing on it teaches people to ignore this test.
      */
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text();
        if (/favicon/i.test(text)) return;
        errors.push(text);
      });
      page.on("pageerror", (e) => errors.push(String(e)));

      await page.goto(role.landsOn);
      await page.waitForLoadState("networkidle");

      expect(errors, `${role.key} saw console errors:\n${errors.join("\n")}`).toEqual([]);
    });
  });
}

test.describe("the desk approval queue is reachable", () => {
  /*
    Named specifically because this is the regression the whole harness exists
    for. Six procedures behind this screen had no caller; STI-105 wired them
    and nothing has stopped it regressing since.
  */
  test.use({ storageState: authFile("owner") });

  test("opens from the Custody screen", async ({ page }) => {
    await page.goto("/custody?tab=queue");
    await expect(page).toHaveURL(/tab=queue/);
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    /* The seed keeps one pending assignment and one pending transfer precisely
       so this queue is never empty on a clean database (STI-108). */
    await expect(page.getByText(/approve/i).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("the visibility ladder narrows what a browser shows", () => {
  /*
    The ladder is unit-tested against the query layer, and this is the half
    that proves a person actually sees the difference. Two roles, side by side,
    on the same screen: the numbers must differ.
  */
  test("the desk's Tools-by-Jobsite panel outnumbers a foreman's holdings", async ({ browser }) => {
    const desk = await (await browser.newContext({ storageState: authFile("warehouse") })).newPage();
    const foreman = await (await browser.newContext({ storageState: authFile("foreman") })).newPage();

    /* Both read the SAME panel source — `asset.list` — through two sessions,
       which is the point: one procedure, two answers, decided by the ladder. */
    await desk.goto("/desk");
    await foreman.goto("/my-tools");

    const deskText = await desk.getByText(/of \d+ record the truck or trailer/).textContent();
    const deskTotal = Number(/of (\d+)/.exec(deskText ?? "")?.[1] ?? "0");

    await expect(foreman.getByText(/You are holding \d+ tool/)).toBeVisible({ timeout: 10_000 });
    const heldText = await foreman.getByText(/You are holding \d+ tool/).textContent();
    const held = Number(/(\d+)/.exec(heldText ?? "")?.[1] ?? "0");

    /* Both non-zero, or the comparison holds vacuously for a ladder wired to
       return nothing — the failure this whole suite is most likely to miss. */
    expect(deskTotal, "the desk sees no tools at all").toBeGreaterThan(0);
    expect(held, "the foreman sees no tools at all").toBeGreaterThan(0);
    /* Strictly greater, not >=. Equal would mean the foreman is seeing the
       whole fleet, which is exactly the leak STI-302 closed. */
    expect(deskTotal).toBeGreaterThan(held);
  });
});
