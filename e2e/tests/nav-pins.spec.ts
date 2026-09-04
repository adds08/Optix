import { test, expect, type Page } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  Pinned navigation rows (STI-1203).

  Read-only against the database, like every other spec here — a pin is a
  `localStorage` key in one browser context, which Playwright discards with the
  context. Nothing this file does can be seen by another worker, so the
  isolation note in `playwright.config.ts` still holds.

  What is worth testing is not "does clicking a star draw a star". It is the
  two properties the feature is allowed to be wrong about:

    - a pin must survive a reload, or it is not a preference
    - a pin must NOT be able to conjure a link the actor's permissions do not
      already grant. Pins live in storage, which the person holding the browser
      can edit; rendering them straight out of it would turn a client-side list
      into access control. `nav-pins.ts` resolves them against the same
      permission-filtered array the rail draws from, and the two tests at the
      bottom are what hold that in place.
*/

const PINNED = '[data-sidebar="group-label"]:text-is("Pinned")';

/* The Pinned SECTION, addressed through its own label.

   Not `[data-sidebar="menu"]` and a `.first()`: the job-scope switcher in the
   sidebar header is itself a `SidebarMenu`, so the first menu on the page is
   an empty one and every assertion below quietly measured it. */
const pinnedLinks = (page: Page) =>
  page
    .locator('[data-sidebar="group"]', { has: page.locator(PINNED) })
    .locator("a[href]");

/* The shell fills the sidebar only once `identity.me` has resolved — before
   that the permission filter runs against an empty array and every gated row
   is missing. The account button is the shell's own signal that it has
   landed; see the longer note in `reachability.spec.ts`. */
async function settled(page: Page, href: string) {
  await page.goto(href);
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({
    timeout: 30_000,
  });
}

const seedPins = (page: Page, ids: string[]) =>
  page.addInitScript((v) => localStorage.setItem("sti-pins", v), JSON.stringify(ids));

test.describe("pinned navigation rows", () => {
  test.use({ storageState: authFile("owner") });

  test("a pinned row survives a reload", async ({ page }) => {
    await settled(page, "/custody");
    await expect(page.locator(PINNED)).toHaveCount(0);

    await page.getByLabel("Pin Custody").click();
    await expect(page.locator(PINNED)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator(PINNED)).toBeVisible();
    /* EXACTLY ONE row carries the route: pinning MOVES a row into the Pinned
       section rather than copying it there.

       This asserted 2 until 2026-08-28, when the both-places behaviour was
       reversed — two identical rows inches apart read as a duplicate rather
       than as a shortcut. The count is the whole difference between the two
       designs, so it is asserted exactly rather than loosely. */
    await expect(page.locator('[data-sidebar="sidebar"] a[href="/custody"]')).toHaveCount(1);
  });

  test("a pinned row leaves its own group rather than appearing twice", async ({ page }) => {
    /* Custody lives in Equipment, so standing ON Equipment is the case where
       a copy would be visible — the pinned row and the group row would both be
       in the pane at once. */
    await seedPins(page, ["custody"]);
    await settled(page, "/custody");

    await expect(page.locator(PINNED)).toBeVisible();
    await expect(page.locator('[data-sidebar="sidebar"] a[href="/custody"]')).toHaveCount(1);

    /* The module it left is still reachable from the launcher — pinning a row
       of a module must not make the module's door disappear. */
    await page.locator('[data-slot="feature-menu-trigger"]').click();
    await expect(page.locator('[data-slot="feature-menu-module"]', { hasText: "Equipment" })).toBeVisible();
  });

  test("unpinning removes the section again", async ({ page }) => {
    await seedPins(page, ["custody"]);
    await settled(page, "/custody");
    await expect(page.locator(PINNED)).toBeVisible();

    /* Both stars name the same row; the first is the one inside Pinned. */
    await page.getByLabel("Unpin Custody").first().click();
    await expect(page.locator(PINNED)).toHaveCount(0);
  });

  test("an id that names nothing is ignored rather than rendered", async ({ page }) => {
    await seedPins(page, ["a-module-that-was-deleted", "custody"]);
    await settled(page, "/custody");

    await expect(page.locator(PINNED)).toBeVisible();
    /* One real row came back and the junk did not become anything — a link
       with no href, an empty row, or a crash. */
    await expect(pinnedLinks(page)).toHaveCount(1);
    await expect(pinnedLinks(page)).toHaveAttribute("href", "/custody");
  });
});

test.describe("a pin is not a permission", () => {
  /*
    The whole point of the intersection. HR can see `/people` and cannot see
    `/tools` or `/custody`; a storage key naming all three must produce exactly
    one row. If this ever fails, somebody has started rendering pins straight
    out of `localStorage` and the sidebar has become forgeable.
  */
  test.use({ storageState: authFile("hr") });

  test("a pin naming a forbidden route does not render it", async ({ page }) => {
    await seedPins(page, ["tool-register", "custody", "people"]);
    await settled(page, "/home");

    await expect(page.locator(PINNED)).toBeVisible();
    await expect(pinnedLinks(page)).toHaveCount(1);
    await expect(pinnedLinks(page)).toHaveAttribute("href", "/people");
  });
});
