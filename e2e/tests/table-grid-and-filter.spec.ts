import { test, expect, type Page } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  The register reads like a spreadsheet: ruled cells, a pager above the header,
  and a filter menu on every column that holds a value.

  Each of these was reported rather than designed, and each of them replaces an
  earlier decision that had a reason at the time:

  - Cells were sectioned by alternating tone rather than by lines. That reads
    fine on the darker themes and dissolves on the pale ones, and it gives a
    wide row no track to follow along.
  - The pager sat under the last row, which is where most web tables put it and
    is not where Urban's timesheet puts it.
  - Column filtering existed only in the Filters sheet, which no one thinks to
    open, because every grid they have ever used puts it in the header.

  Read-only, like every spec here.
*/
test.use({ storageState: authFile("owner") });

async function register(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tools");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });
  /* The register re-renders as its queries land, and anything measured
     mid-render is measured at the wrong place. */
  await page.waitForTimeout(700);
}

test("every cell is ruled horizontally and vertically", async ({ page }) => {
  await register(page);

  const grid = await page.evaluate(() => {
    const px = (el: Element, prop: string) =>
      Math.round(parseFloat(getComputedStyle(el).getPropertyValue(prop)) || 0);

    const headCells = [...document.querySelectorAll("thead th")];
    const firstRow = document.querySelector("tbody tr") as HTMLElement;
    const bodyCells = [...firstRow.querySelectorAll("td")];
    const rows = [...document.querySelectorAll("tbody tr")];

    return {
      /* The trailing edge of the last column is the container's own border, so
         only the cells BEFORE it should carry their own right-hand rule. */
      headRuled: headCells.slice(0, -1).every((c) => px(c, "border-right-width") > 0),
      bodyRuled: bodyCells.slice(0, -1).every((c) => px(c, "border-right-width") > 0),
      lastHeadBare: px(headCells[headCells.length - 1], "border-right-width") === 0,
      /*
        Measured on the CELLS, not on the `<tr>`.

        The table is `border-collapse: separate` — it has to be, or the borders
        of the columns scrolling under a frozen one streak across it — and under
        `separate` a border declared on a row does not paint at all. `TableRow`
        still carries Tailwind's `border-b`, so asking the row for its
        `border-bottom-width` returns 1px whether or not a line is drawn. That
        assertion would pass forever and prove nothing.
      */
      rowsRuled: rows
        .slice(0, -1)
        .every((r) => [...r.querySelectorAll("td")].every((c) => px(c, "border-bottom-width") > 0)),
      headUnderlined: px(headCells[0], "border-bottom-width") > 0,
      cols: headCells.length,
    };
  });

  expect(grid.cols).toBeGreaterThan(3);
  expect(grid.headRuled).toBe(true);
  expect(grid.bodyRuled).toBe(true);
  expect(grid.lastHeadBare).toBe(true);
  expect(grid.rowsRuled).toBe(true);
  expect(grid.headUnderlined).toBe(true);
});

test("the pager sits above the column headers", async ({ page }) => {
  await register(page);

  const order = await page.evaluate(() => {
    const pager = document.querySelector('[aria-label="Next page"]')!.closest("div")!.parentElement!;
    const thead = document.querySelector("thead") as HTMLElement;
    return {
      pagerBottom: Math.round(pager.getBoundingClientRect().bottom),
      headTop: Math.round(thead.getBoundingClientRect().top),
    };
  });

  /* Above, not merely elsewhere: the whole point of the move is that the page
     controls do not walk down the screen as the table gets longer. */
  expect(order.pagerBottom).toBeLessThanOrEqual(order.headTop);
});

test("a column's menu filters the table by value, and clears again", async ({ page }) => {
  await register(page);

  /* The pager's own total, not the rows on screen. The register holds far more
     tools than one page, so dropping a whole category still leaves the page
     full — counting `tbody tr` here would read 25 before and 25 after and prove
     nothing either way. */
  const total = async () => {
    const text = (await page.locator("text=/\\d+–\\d+ of \\d+/").first().textContent()) ?? "";
    return Number(text.split(" of ")[1]);
  };
  const before = await total();
  expect(before).toBeGreaterThan(1);

  await page.getByRole("button", { name: "Category column options" }).click();

  /* Every box starts ticked, because no filter means everything shows. */
  const boxes = page.locator('[role="dialog"] input[type="checkbox"]');
  await expect(boxes.first()).toBeChecked();
  const distinct = await boxes.count();
  expect(distinct).toBeGreaterThan(1);

  /* Unticking one value must remove rows without emptying the table — the
     off-by-one that turns "hide these" into "show only these". */
  await boxes.first().uncheck();
  await page.waitForTimeout(300);
  const narrowed = await total();
  expect(narrowed).toBeLessThan(before);
  expect(narrowed).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Clear filter" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  expect(await total()).toBe(before);
});

test("opening a column menu does not change the header's height", async ({ page }) => {
  await register(page);

  const headHeight = () =>
    page.evaluate(() =>
      Math.round((document.querySelector("thead tr") as HTMLElement).getBoundingClientRect().height),
    );

  const closed = await headHeight();
  await page.getByRole("button", { name: "Category column options" }).click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  expect(await headHeight()).toBe(closed);
});

test("the element that scrolls sideways is the one carrying the scrollbar styling", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto("/tools");
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(700);

  /*
    The register is wider than a 1100px window, so something must scroll. The
    point of this test is WHICH something.

    DataTable used to wrap the shared `<Table>` primitive in its own
    `overflow-x-auto` box and put the styled class on that. The primitive has an
    `overflow-x-auto` container of its own, nested inside — so the box that
    actually scrolled was the unstyled one, and the neat scrollbar was being
    drawn on an element that never overflowed. Nothing visual fails when that is
    wrong; the bar is simply the browser's default, or on macOS not there at all
    until something moves.
  */
  const scroller = await page.evaluate(() => {
    const table = document.querySelector("table") as HTMLElement;
    let el: HTMLElement | null = table.parentElement;
    while (el) {
      if (el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX !== "visible") {
        return { classes: el.className, over: el.scrollWidth - el.clientWidth };
      }
      el = el.parentElement;
    }
    return null;
  });

  expect(scroller).not.toBeNull();
  expect(scroller!.over).toBeGreaterThan(0);
  expect(scroller!.classes).toContain("sti-table-scroll");
});
