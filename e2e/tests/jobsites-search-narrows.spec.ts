import { test, expect } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  Searching a tool's tag narrows the board to jobs that actually hold it.

  Found 2026-09-02 by direct use, not by a spec: typing a specific tool tag
  or serial into the search box left almost every job card on screen. The
  cause was in the prune rule at the bottom of the `cards` derivation — a
  card survives unless it is BOTH toolless AND crewless, and `crews` is built
  before any filter runs, so a job with staff on it always has crews even
  when none of their tools matched. Every staffed job on the board passed
  that test regardless of what was typed, which is the definition of "search
  does nothing."

  This is deliberately NOT scoped to the Cards view: the bug lives in
  page.tsx's shared `cards` array, so it broke the list exactly as much as
  the grid — jobsite-card-view.spec.ts already covers the card-specific
  rendering, this covers the filter itself, on the view where a `section
  header` count is cheapest to read.

  Read-only, like every spec here.
*/
test.use({ storageState: authFile("owner") });

async function settled(page: import("@playwright/test").Page) {
  await page.goto("/jobsites");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("section header").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
}

test("a tag search drops jobs holding none of it, not just the ones that match", async ({ page }) => {
  await settled(page);

  const headers = page.locator("section header");
  const before = await headers.count();
  // Ten real jobs exist in the seeded data; if fewer than that are on screen
  // to start with, the fixture changed and this test needs a new premise.
  expect(before).toBeGreaterThan(5);

  // TOOL-0001 exists on exactly one job, Lone Star. NEX holds 210 tools and
  // none of them is this one.
  await page.getByPlaceholder(/search/i).fill("TOOL-0001");
  await expect(headers.filter({ hasText: "Lone Star" })).toBeVisible();

  // The regression, precisely: NEX has a crew (so `crews.length` was never
  // zero) but nothing matching this tag — it must disappear, not survive on
  // the strength of having staff.
  await expect(headers.filter({ hasText: "NEX" })).toHaveCount(0);

  // And the count overall actually narrowed — not "one card confirmed
  // gone", the whole board did.
  const after = await headers.count();
  expect(after).toBeLessThan(before - 3);
});
