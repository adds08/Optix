import { test, expect } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  Tenant feature presentation (ADR-13, generalizing ADR-11 / STI-1204).

  Read-only against the database, like every other spec here — the seed
  carries the tenant_feature rows this exercises (packages/db/src/seed.ts):
  `old-dashboard` hidden, `activity` beta, and — the one that must never
  actually take effect — `settings-general` hidden. Nothing here writes a row.

  Two properties matter, the same two ADR-11 always cared about for its
  binary predecessor:

    - a hidden module disappears from the nav AND a direct URL redirects,
      so a bookmark cannot land on a screen the rail no longer offers a door
      to.
    - Settings can never be hidden, no matter what a stored row says — proven
      against a seeded row that says exactly that, not just against the
      absence of one.

  What the API actually still allows behind a hidden key is proven separately,
  in packages/api-contracts/src/feature-visibility.test.ts — this file only
  covers what a browser shows.
*/
test.use({ storageState: authFile("owner") });

test("a hidden module (Old Dash) does not appear in its group", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  // Overview is the default active group and holds Old Dash.
  await expect(page.getByRole("link", { name: "Desk", exact: true })).toBeVisible();
  await expect(page.locator('a[href="/old-dash"]')).toHaveCount(0);
});

test("a direct URL to a hidden module redirects to /home", async ({ page }) => {
  await page.goto("/old-dash");
  await expect(page).toHaveURL(/\/home$/, { timeout: 15_000 });
});

test("Settings stays reachable despite a stray row saying it's hidden", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/settings$/);
  // The row itself still renders in the sidebar, not just the page's own URL.
  await expect(page.locator('a[href="/settings"]').first()).toBeVisible();
});

test("a beta-flagged module (Activity) still opens and carries its badge", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Insight" }).click();
  const row = page.locator('a[href="/activity"]').first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(/beta/i);
  await row.click();
  await expect(page).toHaveURL(/\/activity$/);
});
