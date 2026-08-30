import { test, expect } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  Every table's header must have exactly as many cells as its rows.

  A head one cell SHORT of the body does not throw and does not misalign the
  columns — the browser just stops painting the header background where the
  header ran out. On `/jobsites` that showed as a white notch hanging off the
  right end of the header band, above the row menus, which reads as a styling
  artefact rather than as a missing `<th>`. It survived a design review, a
  screenshot and a redesign of that table.

  It is structural, cheap to assert, and applies to every table in the product,
  so it is checked here rather than left to somebody noticing the notch again.

  Read-only, like every spec here.
*/
test.use({ storageState: authFile("owner") });

const SCREENS = ["/jobsites", "/tools", "/people", "/projects", "/custody"];

for (const path of SCREENS) {
  test(`tables on ${path} have matching header and body column counts`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
    /* Cards and tables land after their queries; measuring mid-render would
       compare a half-built table against itself. */
    await page.waitForTimeout(1200);

    const mismatches = await page.evaluate(() => {
      const out: { index: number; head: number; body: number }[] = [];
      document.querySelectorAll("table").forEach((t, index) => {
        const headRow = t.querySelector("thead tr");
        const bodyRow = t.querySelector("tbody tr");
        if (!headRow || !bodyRow) return;
        /* Skip the empty-state row, which spans every column on purpose. */
        if (bodyRow.querySelector("td[colspan]")) return;
        const head = headRow.querySelectorAll("th, td").length;
        const body = bodyRow.querySelectorAll("td").length;
        if (head !== body) out.push({ index, head, body });
      });
      return out;
    });

    expect(mismatches, `header/body column mismatch on ${path}`).toEqual([]);
  });
}
