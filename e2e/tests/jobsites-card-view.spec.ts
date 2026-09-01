import { test, expect } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  The Cards view shows the same world as the list.

  /jobsites gained a second render mode on 2026-09-02: a List | Cards toggle
  where Cards draws a compact grid and each card opens its tools in a right
  sheet. The regression this prevents is the two views drifting apart — the
  card view is a second LAYOUT of the page's single `cards` derivation, and the
  moment somebody gives it a derivation of its own, a filter or the job scope
  can show different tools in the two modes and nobody will notice, because
  each mode looks internally consistent. So this asserts the invariants that
  only hold while the derivation is shared: the grid renders one card per list
  section, and the sheet's tool rows respond to the same search filter the list
  obeys.

  It also pins the storage default: e2e contexts start with clean storage, and
  every other jobsites spec measures the LIST view without saying so. If the
  default ever flips to Cards, this fails before those specs start failing
  mysteriously.

  Read-only, like every spec here — opening a sheet and a menu writes nothing.
*/
test.use({ storageState: authFile("owner") });

async function settled(page: import("@playwright/test").Page) {
  await page.goto("/jobsites");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("section header").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
}

const cardFaces = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^Open tools on / });

test("the default is the list, and Cards renders exactly the list's cards", async ({ page }) => {
  await settled(page);

  // Clean storage lands on List: the layout toggle exists, List is pressed,
  // and no card faces are on screen.
  const layout = page.getByRole("group", { name: "Layout" });
  await expect(layout.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  await expect(cardFaces(page)).toHaveCount(0);

  // One grid card per list section — same array, two layouts.
  const listCount = await page.locator("section header").count();
  await layout.getByRole("button", { name: "Cards" }).click();
  await expect(cardFaces(page)).toHaveCount(listCount);
});

test("a card's sheet shows its tools, and the search filter reaches them", async ({ page }) => {
  await settled(page);
  await page.getByRole("group", { name: "Layout" }).getByRole("button", { name: "Cards" }).click();
  await expect(cardFaces(page).first()).toBeVisible();

  // Narrow with the same search box the list obeys.
  await page.getByPlaceholder(/search/i).fill("grinder");
  await expect(cardFaces(page).first()).toBeVisible();

  // The match preview is the whole point: a surviving card shows WHERE the
  // match is, marked, before anyone opens the sheet — not just a count.
  await expect(cardFaces(page).first().locator("mark").first()).toBeVisible();

  await cardFaces(page).first().click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  // The sheet renders ToolTable in `compact` mode — flexible rows, not a
  // fixed-column table (a table's columns don't fit a narrow panel without a
  // second, nested horizontal scrollbar). Rows carry role="listitem"; a match
  // is still marked exactly like the list view's.
  await expect(sheet.getByRole("listitem").first()).toBeVisible();
  await expect(sheet.locator("mark").first()).toBeVisible();

  // Escape closes the sheet and the grid is still there.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(cardFaces(page).first()).toBeVisible();
});
