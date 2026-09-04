import { test, expect } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  Ticking a checkbox must not move anything.

  Both selectable surfaces grew when a row was selected, because the controls
  that appear were INSERTED into the flow rather than given room in advance:

    - `/jobsites` — the "Waiting in the yard" header was sized by a text line
      when empty and by an `h-6` button when something was ticked. 33px -> 41px.
    - `/tools` — the bulk action bar was its own block that did not exist until
      the first tick, so the table dropped 58px under it.

  Both are measured here rather than eyeballed, because a layout jump is exactly
  the class of bug that gets "fixed" by making it smaller and called done. The
  assertion is equality, not a tolerance: one pixel of movement is the same bug
  as fifty, and an earlier attempt at the jobsites fix left precisely 1px.

  Read-only, like every spec here.
*/
test.use({ storageState: authFile("owner") });

test("selecting a tool in the yard does not resize its section header", async ({ page }) => {
  await page.goto("/jobsites");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  /* The yard moved to the In Yard tab on 2026-08-28 — it is not a job, so it is
     no longer drawn among them. This section only exists there now. */
  await page.getByRole("button", { name: "In Yard", exact: true }).click();
  await expect(page.getByText("Waiting in the yard").first()).toBeVisible({ timeout: 30_000 });
  /* The cards settle after their queries land; measuring mid-render would
     compare two different layouts and pass for the wrong reason. */
  await page.waitForTimeout(600);

  const headerHeight = () =>
    page.evaluate(() => {
      const el = [...document.querySelectorAll("div")].find(
        (d) => d.className.includes("border-b") && d.textContent?.startsWith("Waiting in the yard"),
      );
      return el ? el.getBoundingClientRect().height : -1;
    });

  const before = await headerHeight();
  expect(before, "the section header was not found — the selector needs updating").toBeGreaterThan(0);

  await page.locator('input[type="checkbox"], [role="checkbox"]').nth(1).click();
  await page.waitForTimeout(400);

  expect(await headerHeight()).toBe(before);
});

test("selecting a tool in the register does not push the table down", async ({ page }) => {
  await page.goto("/tools");
  await page.locator("table tbody tr").first().waitFor();

  const tableTop = () =>
    page.evaluate(() => {
      const el = document.querySelector("table") as HTMLElement | null;
      /* Corrected by the SCROLL CONTAINER's offset, not the window's.

         `getBoundingClientRect().top` is viewport-relative, so it moves when
         the page scrolls even though the layout did not. Playwright scrolls a
         target into view before clicking it, which is enough to make this read
         2 instead of 171 — CI failed exactly that way while passing locally,
         reporting a layout shift that had not happened.

         `window.scrollY` does NOT fix it: this shell never scrolls the window.
         It scrolls an inner `.sti-scroll` region, so the window offset is
         always 0 and the correction would be a no-op. Measured: at rest the
         table reads 171, and with the container scrolled 300 it reads -129
         while `window.scrollY` stays 0. Walking up to the real scrollable
         ancestor and adding its `scrollTop` gives 171 in both cases, which is
         the number this test is actually about. */
      if (!el) return -1;
      let n: HTMLElement | null = el.parentElement;
      let corrected = el.getBoundingClientRect().top;
      while (n) {
        const style = getComputedStyle(n);
        if (/(auto|scroll)/.test(style.overflowY) && n.scrollHeight > n.clientHeight) {
          corrected += n.scrollTop;
          break;
        }
        n = n.parentElement;
      }
      return Math.round(corrected);
    });

  const before = await tableTop();
  expect(before).toBeGreaterThan(0);

  await page
    .locator("table tbody tr td:first-child button, table tbody tr td:first-child input")
    .first()
    .click();
  await page.waitForTimeout(400);

  /* The bulk actions now swap into the toolbar row that was already there, so
     the table must not have moved at all. */
  expect(await tableTop()).toBe(before);
});
