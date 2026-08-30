import { test, expect, type Page } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  Freezing, on both axes, and the row menu split in two.

  Columns freeze as a PREFIX — "freeze up to this column" — because that is what
  a spreadsheet does and because pinning a middle column on its own raises "and
  where does it sit now", to which every answer is worse than not offering it.
  Rows freeze individually, through TanStack's row pinning, so a frozen row
  survives a page change; that is the whole reason to freeze one.

  The row menu now answers two questions under two headings and no more: what do
  I do to this THING, and how do I look at this TABLE.

  Read-only, like every spec here. Freezing is browser state — a localStorage
  count for columns, memory for rows — so nothing here writes a row.
*/
test.use({ storageState: authFile("owner") });

async function register(page: Page) {
  /* Narrow enough that the register genuinely overflows, or there is nothing
     for a frozen column to stay in front of. */
  await page.setViewportSize({ width: 1150, height: 900 });
  await page.goto("/tools");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(700);
}

const scrollTable = (page: Page, x: number) =>
  page.evaluate((left) => {
    const el = document.querySelector(".sti-table-scroll") as HTMLElement;
    el.scrollLeft = left;
  }, x);

/* Where the TAG column's header actually is on screen. A frozen column keeps
   this number while the table scrolls under it; an unfrozen one loses it. */
const tagLeft = (page: Page) =>
  page.evaluate(() => {
    const th = [...document.querySelectorAll("thead th")].find((h) =>
      /TAG/i.test(h.textContent ?? ""),
    ) as HTMLElement;
    return Math.round(th.getBoundingClientRect().left);
  });

async function freezeUpToTag(page: Page) {
  await page.getByRole("button", { name: "Tag column options" }).click();
  await page.getByText("Freeze up to here").click();
  await page.waitForTimeout(400);
}

test("a frozen column stays put while the rest scroll under it", async ({ page }) => {
  await register(page);

  /* The control group first: unfrozen, the column travels with the table. */
  const restLeft = await tagLeft(page);
  await scrollTable(page, 400);
  await page.waitForTimeout(300);
  expect(await tagLeft(page)).toBeLessThan(restLeft - 100);

  await scrollTable(page, 0);
  await page.waitForTimeout(300);
  await freezeUpToTag(page);

  const frozenAt = await tagLeft(page);
  await scrollTable(page, 400);
  await page.waitForTimeout(300);
  expect(await tagLeft(page)).toBe(frozenAt);
});

test("the freeze survives a reload, and unfreezing releases it", async ({ page }) => {
  await register(page);
  await freezeUpToTag(page);

  await page.reload();
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(900);

  const frozenAt = await tagLeft(page);
  await scrollTable(page, 400);
  await page.waitForTimeout(300);
  expect(await tagLeft(page), "the freeze did not survive the reload").toBe(frozenAt);

  await scrollTable(page, 0);
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Tag column options" }).click();
  await page.getByText("Unfreeze columns").click();
  await page.waitForTimeout(400);

  const loose = await tagLeft(page);
  await scrollTable(page, 400);
  await page.waitForTimeout(300);
  expect(await tagLeft(page)).toBeLessThan(loose - 100);

  /* Leave the browser as it was found — the storage key is shared with every
     other spec that opens this register. */
  await page.evaluate(() => localStorage.removeItem("sti-frozen:tool-register"));
});

test("the row menu is split into what it does and how it looks", async ({ page }) => {
  await register(page);

  const firstTag = await page.locator("tbody tr").first().locator("td").nth(2).innerText();
  await page.locator("tbody tr").first().getByRole("button", { name: /^Actions for/ }).click();

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  /* Two headings, and the row's own name above them. Not three, not one. */
  await expect(menu.getByText("Actions", { exact: true })).toBeVisible();
  await expect(menu.getByText("Table", { exact: true })).toBeVisible();
  await expect(menu.getByText("Freeze this row")).toBeVisible();

  await page.keyboard.press("Escape");
  expect(firstTag.length).toBeGreaterThan(0);
});

test("a frozen row is lifted to the top and stays there through a page change", async ({ page }) => {
  await register(page);

  /* Freeze something from the middle of the page, so "it is at the top" cannot
     be true by accident. */
  const target = page.locator("tbody tr").nth(4);
  const targetText = (await target.locator("td").nth(2).innerText()).trim();
  await target.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByText("Freeze this row").click();
  await page.waitForTimeout(400);

  const topText = async () =>
    (await page.locator("tbody tr").first().locator("td").nth(2).innerText()).trim();
  expect(await topText()).toBe(targetText);

  /* The point of freezing a row is that it is still there when you go looking
     through the rest of the register. */
  await page.getByRole("button", { name: "Next page" }).click();
  await page.waitForTimeout(600);
  expect(await topText(), "the frozen row did not survive a page change").toBe(targetText);

  await page.locator("tbody tr").first().getByRole("button", { name: /^Actions for/ }).click();
  await page.getByText("Unfreeze this row").click();
  await page.waitForTimeout(400);
  expect(await topText()).not.toBe(targetText);
});
