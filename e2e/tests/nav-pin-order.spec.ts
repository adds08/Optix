import { test, expect } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  Pinned rows can be reordered, and the first one is where a session lands.

  The ordering half changes a decision `nav-pins.ts` used to defend: pins were
  sorted by the NAVIGATION tree, on the reasoning that the tree's order is
  stable and already learned. That stops being right once the list can be
  rearranged — a list you can move but which re-sorts itself is worse than one
  you cannot move at all — so the stored array's order is now believed.

  The landing half is the one worth guarding hardest, because it is a REDIRECT
  driven by `localStorage`. It resolves through `pinnedItems`, so it inherits
  the permission intersection: a pin naming a route the actor cannot open must
  not become a destination. That is the same forgeability rule as the sidebar,
  in a place where getting it wrong is worse.

  Read-only against the database, like every spec here — pins are a storage key
  in one browser context, which Playwright discards with the context.
*/

/* The Pinned SECTION, addressed through its own label — the same approach as
   `nav-pins.spec.ts`, and for the same reason: the job-scope switcher in the
   sidebar header is itself a `SidebarMenu`, so anything anchored on the first
   menu on the page measures an empty one. */
const PINNED_LABEL = '[data-sidebar="group-label"]:text-is("Pinned")';
const pinnedLinks = (page: import("@playwright/test").Page) =>
  page.locator('[data-sidebar="group"]', { has: page.locator(PINNED_LABEL) }).locator("a[href]");

test.describe("pinned order", () => {
  test.use({ storageState: authFile("owner") });

  test("moving a pin up changes the order and persists it", async ({ page }) => {
    /* `addInitScript`, not an `evaluate` after loading: it runs before the
       page's own scripts on every navigation, so the pins are already there
       when `useNavPins` reads storage in its mount effect. The same helper
       `nav-pins.spec.ts` uses. */
    await page.addInitScript((v) => localStorage.setItem("sti-pins", v), JSON.stringify(["custody", "tool-register"]));
    await page.goto("/home");

    /* The shell fills the sidebar only once `identity.me` has resolved —
       before that the permission filter runs against an empty array and every
       gated row is missing, so an immediate read finds no pins at all. The
       account button is the shell's own signal that it has landed. */
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });

    const labels = () => pinnedLinks(page).allInnerTexts();
    await expect(pinnedLinks(page)).toHaveCount(2);
    expect((await labels()).map((t) => t.trim())).toEqual(["Custody", "Small Tools"]);

    /* The controls are hover-revealed, so the row has to be hovered before its
       "move up" is clickable — the same reason they cost no layout space. */
    const second = pinnedLinks(page).nth(1);
    await second.hover();
    await page.getByRole("button", { name: "Move Small Tools up" }).click();

    expect((await labels()).map((t) => t.trim())).toEqual(["Small Tools", "Custody"]);

    /*
      Persistence is asserted on the STORED value rather than by reloading.

      `addInitScript` re-runs on every navigation, so a reload here would write
      the seed back over the move and the test would be checking the fixture
      rather than the feature. The stored array is what a reload would read, so
      this is the same guarantee without the fight.
    */
    const stored = await page.evaluate(() => localStorage.getItem("sti-pins"));
    expect(JSON.parse(stored ?? "[]")).toEqual(["tool-register", "custody"]);
  });
});

test.describe("returning to the app also lands on the first pin", () => {
  test.use({ storageState: authFile("owner") });

  test("opening / with a session already in hand goes to the pin, not /home", async ({ page }) => {
    /*
      The gap this covers: only a fresh SIGN-IN used to arm the landing, so
      every later visit went to /home and "the first pin is the default
      navigation" was true exactly once per session. Both routes through `/`
      arm it now.
    */
    await page.addInitScript((v) => localStorage.setItem("sti-pins", v), JSON.stringify(["custody"]));
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/custody$/, { timeout: 15_000 });
  });

  test("with nothing pinned it still lands on /home", async ({ page }) => {
    /* The redirect resolves to null when there are no pins, and the caller
       keeps its existing destination. Without this, "no pins" and "broken
       redirect" would look identical. */
    await page.addInitScript(() => localStorage.removeItem("sti-pins"));
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/home$/);
  });
});

test.describe("the first pin is where a session lands", () => {
  test("signing in opens the first pinned row rather than /home", async ({ page }) => {
    /* A real sign-in, because the redirect is armed by a one-shot marker that
       only the sign-in path sets. Seeding the pin first: it is read from the
       same origin the app runs on. */
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("sti-pins", JSON.stringify(["custody"])));

    await page.getByLabel(/email/i).fill("owner@stinventory.local");
    await page.getByLabel(/password/i).fill("stinventory-demo");
    await page.getByRole("button", { name: /sign in/i }).click();

    /*
      Wait for the shell to be READY, then assert the URL.

      The redirect cannot happen until `identity.me` resolves — that is the
      guard in `app-shell.tsx`, without which the one-shot marker is spent on a
      render that has no permissions yet. So the account button appearing is the
      earliest moment the assertion can be true, and waiting on it is
      deterministic where a longer timeout is a guess.

      This is why it failed in CI and passed locally: sign-in plus the first
      `me` round trip on a cold stack takes longer than the 5s default, so the
      URL was still /home when the assertion gave up.
    */
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/custody$/, { timeout: 15_000 });
  });

  test("a pin the actor may not open does not become a redirect", async ({ page }) => {
    /* HR holds no `asset.read`, so `tool-register` is filtered out of the
       groups the redirect resolves against. It must land on /home instead —
       a storage key must never be able to steer somebody into a route their
       permissions do not grant. */
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("sti-pins", JSON.stringify(["tool-register"])));

    await page.getByLabel(/email/i).fill("hr@stinventory.local");
    await page.getByLabel(/password/i).fill("stinventory-demo");
    await page.getByRole("button", { name: /sign in/i }).click();

    /*
      Wait for the shell to settle BEFORE asserting nothing moved.

      A test that checks "no redirect happened" immediately can pass simply by
      looking too early, which is a pass for the wrong reason and worse than a
      failure. The account button is the point at which the redirect would have
      fired if it were going to — so /home surviving past it is the real claim.
    */
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/home$/);
  });
});
