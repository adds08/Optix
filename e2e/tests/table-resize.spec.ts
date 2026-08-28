import { test, expect, type Page } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  Columns can be dragged wider, and the table scrolls rather than squeezing.

  The register carries more columns than fit a laptop, so something has to give.
  Before this it was always the same thing: `table-fixed` shares a fixed table
  width among its columns, so the one column without a declared width — the tool
  name, the one people actually read — absorbed the shortfall and clipped every
  row.

  The property that matters is in the second test. Widening a column must make
  the TABLE wider, not steal the pixels from its neighbours. That only works
  because the first drag converts every column to an explicit pixel width at
  once; a half-converted table quietly redistributes instead, which looks like
  the drag doing nothing.

  Read-only, like every spec here.
*/
test.use({ storageState: authFile("owner") });

const KEY = "sti-colwidths:tool-register";

async function register(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tools");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });
  /* The register re-renders as its queries land, and a grip measured mid-render
     is measured at the wrong x — the drag then starts in empty space and does
     nothing. This is why the first two tests failed while an identical drag
     later in the file passed. */
  await page.waitForTimeout(700);
}

const measure = (page: Page) =>
  page.evaluate(() => {
    const heads = [...document.querySelectorAll("thead th")];
    const cat = heads.find((h) => /CATEGORY/i.test(h.textContent ?? ""));
    const headRow = document.querySelector("thead tr") as HTMLElement;
    return {
      cat: cat ? Math.round(cat.getBoundingClientRect().width) : -1,
      table: Math.round((document.querySelector("table") as HTMLElement).getBoundingClientRect().width),
      headHeight: Math.round(headRow.getBoundingClientRect().height),
    };
  });

async function dragCategory(page: Page, dx: number) {
  const grip = page.locator('thead th:has-text("CATEGORY") [role="separator"]');
  const box = (await grip.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test("dragging a column's edge resizes it", async ({ page }) => {
  await register(page);
  const before = await measure(page);
  await dragCategory(page, 120);
  const after = await measure(page);
  expect(after.cat).toBeGreaterThan(before.cat + 100);
});

test("widening a column widens the TABLE rather than squeezing its neighbours", async ({ page }) => {
  await register(page);
  const before = await measure(page);
  await dragCategory(page, 120);
  const after = await measure(page);
  /* The point of the feature: the wrapper scrolls, the other columns keep their
     size. If the table width were unchanged, the pixels came from a neighbour. */
  expect(after.table).toBeGreaterThan(before.table + 100);
});

test("the header does not change height while resizing", async ({ page }) => {
  await register(page);
  const before = await measure(page);
  await dragCategory(page, 90);
  const after = await measure(page);
  /* The grip is absolutely positioned precisely so it costs no layout space —
     the rule in .claude/rules/web.md. */
  expect(after.headHeight).toBe(before.headHeight);
});

test("a resize does not also sort the column", async ({ page }) => {
  await register(page);
  const firstBefore = await page.locator("tbody tr td:nth-child(2)").first().innerText();
  await dragCategory(page, 80);
  const firstAfter = await page.locator("tbody tr td:nth-child(2)").first().innerText();
  /* The grip sits above the sort button; without stopPropagation every resize
     would re-sort the table on release. */
  expect(firstAfter).toBe(firstBefore);
});

test("widths survive a reload, and a double-click gives the column back", async ({ page }) => {
  await register(page);
  const before = await measure(page);
  await dragCategory(page, 120);
  const widened = await measure(page);

  await page.reload();
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });
  expect((await measure(page)).cat).toBe(widened.cat);

  await page.locator('thead th:has-text("CATEGORY") [role="separator"]').dblclick();
  await page.waitForTimeout(300);
  expect((await measure(page)).cat).toBe(before.cat);

  const stored = await page.evaluate((k) => localStorage.getItem(k), KEY);
  expect(stored).not.toContain('"Category"');
});
