import { test, expect } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  Tenant feature presentation (ADR-13, generalizing ADR-11 / STI-1204).

  Read-only against the database, like every other spec here — the seed
  carries the tenant_feature rows this exercises (packages/db/src/seed.ts):
  `activity` beta, and — the one that must never actually take effect —
  `settings-general` hidden. Nothing here writes a row.

  The hidden-module half of this file left with /old-dash on 2026-09-03: the
  widget dashboard was that demo's subject (a real module seeded `hidden` so a
  browser could prove the row vanishes and a direct URL redirects). Both the
  module and the demo row are gone, so those two proofs now rest on the unit
  tests in packages/api-contracts/src/feature-visibility.test.ts plus the
  exemption test below — a stray row hiding the General settings row is the
  one hidden-state the product still seeds on purpose.

  Two properties matter, the same two ADR-11 always cared about for its
  binary predecessor:

    - a beta-flagged module still opens and carries its badge.
    - Settings can never be hidden, no matter what a stored row says — proven
      against a seeded row that says exactly that, not just against the
      absence of one.

  What the API actually still allows behind a hidden key is proven separately,
  in packages/api-contracts/src/feature-visibility.test.ts — this file only
  covers what a browser shows.
*/
test.use({ storageState: authFile("owner") });

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

  /* The rail is gone (design has no rail); modules live in the feature
     launcher behind the top-bar breadcrumb. Open it, pick the Reports module,
     and the Activity card is right there in the pane. */
  await page.locator('[data-slot="feature-menu-trigger"]').click();
  await page.locator('[data-slot="feature-menu-module"]', { hasText: "Reports" }).click();
  const row = page.locator('[data-slot="feature-menu-card"]', { hasText: "Activity" }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(/beta/i);
  await row.click();
  await expect(page).toHaveURL(/\/activity$/);
});
