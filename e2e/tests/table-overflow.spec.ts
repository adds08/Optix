import { test, expect } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  A cell's contents must stay inside the cell.

  `StatusPill` is `whitespace-nowrap`, so when it does not fit it cannot wrap —
  it overflows and prints across the column beside it. That is what "IN
  MAINTENANCE" did: fourteen mono uppercase characters with 0.1em tracking, a
  dot and a border came to 134px in a column sized 8.5rem, whose content box
  after padding was narrower still, so the pill ran into Holder.

  The status column is now sized for the LONGEST value the enum permits rather
  than the common one. The local seed only ever holds `available` and
  `assigned`, so the long case cannot be observed by looking — the test swaps
  the label in and measures, which is the only way this stays honest on a
  dataset that does not contain the problem.

  Read-only, like every spec here.
*/
test.use({ storageState: authFile("owner") });

test("the longest status pill stays inside its column", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tools");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });

  const overflow = await page.evaluate(() => {
    const heads = [...document.querySelectorAll("thead th")].map((h) => (h.textContent ?? "").trim());
    const idx = heads.findIndex((h) => /STATUS/i.test(h));
    const cell = document.querySelector("tbody tr")!.children[idx] as HTMLElement;
    const pill = cell.querySelector("span") as HTMLElement;

    /* `in_maintenance` is the longest member of ASSET_STATUSES. Substituted
       because no seeded row carries it. */
    const textNode = [...pill.childNodes].find((n) => n.nodeType === 3);
    if (textNode) textNode.textContent = "IN MAINTENANCE";

    const cs = getComputedStyle(cell);
    const inner = cell.getBoundingClientRect().width
      - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return Math.round(pill.getBoundingClientRect().width - inner);
  });

  /* Positive means the pill is wider than the space it has and is printing
     over the next column. */
  expect(overflow, "IN MAINTENANCE overflows the Status column by this many px").toBeLessThanOrEqual(0);
});

test("tool names are readable rather than clipped to nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tools");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });

  const r = await page.evaluate(() => {
    const heads = [...document.querySelectorAll("thead th")].map((h) => (h.textContent ?? "").trim());
    const idx = heads.findIndex((h) => /TOOL/i.test(h));
    const rows = [...document.querySelectorAll("tbody tr")];
    let clipped = 0, withTitle = 0;
    for (const tr of rows) {
      const span = (tr.children[idx] as HTMLElement)?.querySelector("span.truncate") as HTMLElement | null;
      if (!span) continue;
      if (span.scrollWidth > span.clientWidth + 1) clipped++;
      if (span.getAttribute("title")) withTitle++;
    }
    const cell = document.querySelector("tbody tr")!.children[idx] as HTMLElement;
    return { rows: rows.length, clipped, withTitle, width: Math.round(cell.getBoundingClientRect().width) };
  });

  /* The column was 192px and clipped every single row. It is not possible to
     fit every name — some run to 48 characters — so the guarantee is that the
     column is wide enough for most, and that a clipped one is still readable
     through its `title`. */
  expect(r.width).toBeGreaterThanOrEqual(300);
  expect(r.clipped).toBeLessThan(r.rows / 2);
  expect(r.withTitle, "every name carries its full text as a title").toBe(r.rows);
});
