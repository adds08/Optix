import { test, expect } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  The Equipment Yard is not a job.

  Urban carries a project literally called "Equipment Yard" — two of them — plus
  the page's own synthetic yard card. All three were drawn in the Jobs tab as
  ordinary sites while holding no tools, so the job list was padded with places
  nobody is working.

  Both directions are asserted, and the second is the one that matters: the first
  attempt at this filtered the yard out of Jobs and, because the pool filter ran
  afterwards and kept rows by id, dropped the real yard projects out of the Pool
  as well. They vanished from the product entirely and the diff looked right.
  Counting cards on both tabs is what caught it.

  Read-only, like every spec here.
*/
test.use({ storageState: authFile("owner") });

const headers = (page: import("@playwright/test").Page) => page.locator("section header");

async function settled(page: import("@playwright/test").Page) {
  await page.goto("/jobsites");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect(headers(page).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
}

test("the Jobs tab shows no Equipment Yard, and still shows the real jobs", async ({ page }) => {
  await settled(page);
  const texts = await headers(page).allInnerTexts();
  expect(texts.filter((t) => /Equipment Yard/.test(t))).toHaveLength(0);
  /* Not vacuous: the tab must still be full of actual jobs. */
  expect(texts.length).toBeGreaterThan(5);
});

test("the Pool tab carries every yard card, so none were lost", async ({ page }) => {
  await settled(page);
  await page.getByRole("button", { name: "Pool", exact: true }).click();
  await page.waitForTimeout(800);

  const texts = await headers(page).allInnerTexts();
  expect(texts.filter((t) => /Equipment Yard/.test(t)).length).toBeGreaterThan(0);
  /* The pool is the yard plus the project-less group — never the job list. */
  expect(texts.length).toBeLessThan(6);
});

test("the Pool tab says what it holds, and the Jobs tab does not", async ({ page }) => {
  await settled(page);
  await expect(page.getByText(/in the yard/)).toHaveCount(0);

  await page.getByRole("button", { name: "Pool", exact: true }).click();
  await page.waitForTimeout(800);
  /* A count of tools in the yard and tools held by somebody with no job —
     the two cards below it, summarised. */
  await expect(page.getByText(/in the yard/).first()).toBeVisible();
  await expect(page.getByText(/held with no job/).first()).toBeVisible();
});
