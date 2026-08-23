import { test, expect, type Page } from "@playwright/test";
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

/*
  Every route this role is offered anywhere in the shell.

  The shell is two panes: the rail says which MODULE you are in, and the sidebar
  lists that module's screens and only that module's screens. So "what
  navigation is this role offered" is not readable from a single page load — it
  is the union across every rail group, and asking `/home` alone quietly reduced
  the question to "what is in Overview".

  That is what broke these two tests on 2026-08-23, when the sidebar stopped
  listing every group. The visible half failed loudly: owner is offered /tools,
  but from /home the Equipment group's rows are not in the DOM at all. The other
  half failed silently and is the more dangerous one — with a single group
  rendered, almost any forbidden href is absent no matter what the permissions
  say, so the assertion that catches a permission WIDENING had been passing
  vacuously ever since.

  Walking the rail restores both. Hrefs are read from the DOM rather than from
  `nav-config.ts`: a test that imports the thing it is testing proves only that
  the file parses.
*/
async function offeredRoutes(page: Page, start: string): Promise<string[]> {
  const hrefsIn = (selector: string) =>
    page
      .locator(selector)
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? "").filter(Boolean),
      );

  /*
    Waiting for `[data-sidebar]` to be VISIBLE is not enough, and getting that
    wrong reads as a permission bug rather than a race.

    The shell filters both panes against `me.permissions`, which arrives from
    `identity.me` after the first paint. Until it resolves, `perms` is `[]` and
    the only rows that survive the filter are the ones carrying no `perm` at
    all. Collected at that moment, an owner who can see everything reports
    exactly `/desk`, `/home`, `/old-dash` and `/settings/appearance` — the four
    ungated rows — and every gated group looks forbidden.

    `networkidle` is what the console-error test below already waits for, and it
    is the honest signal here: the nav is settled once the queries behind it
    have stopped.
  */
  const settledNav = async (href: string) => {
    await page.goto(href);
    await expect(page.locator("[data-sidebar]").first()).toBeVisible({ timeout: 10_000 });
    await page.waitForLoadState("networkidle");
  };

  await settledNav(start);

  /* The rail links one row per group — its FIRST visible row — so this is the
     set of groups the permission filter left standing, not the set of screens. */
  const groups = await hrefsIn('nav[aria-label="Sections"] a[href]');

  const offered = new Set<string>();
  for (const href of [start, ...groups]) {
    await settledNav(href);
    /* Scoped to `[data-sidebar]`, never the page body: the dashboard links to
       /reports/idle, and counting that would make a forbidden route look
       offered. */
    for (const h of await hrefsIn("[data-sidebar] a[href]")) offered.add(h);
  }
  return [...offered];
}

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
      /* `.first()` because the shell renders BOTH — `<body>` and the
         SidebarInset `<main>` — and a bare `main, body` is a strict-mode
         violation. It read as flaky rather than broken: before hydration only
         `body` matches and the assertion passes, so whether it failed depended
         on how fast the page settled. */
      await expect(page.locator("main, body").first()).toBeVisible();
    });

    test("is offered the navigation its permissions imply", async ({ page }) => {
      const offered = await offeredRoutes(page, role.landsOn);
      for (const href of role.expectsRoutes) {
        expect(offered, `${role.key} should be offered ${href}`).toContain(href);
      }
    });

    test("is NOT offered navigation its permissions forbid", async ({ page }) => {
      const offered = await offeredRoutes(page, role.landsOn);
      for (const href of role.forbidsRoutes) {
        expect(offered, `${role.key} must NOT be offered ${href}`).not.toContain(href);
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
