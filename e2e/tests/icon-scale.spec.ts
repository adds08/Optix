import { test, expect, type Page } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  Icon size is its own preference, and it moves the glyphs without moving
  anything else.

  The complaint behind it was "the icons are way too small", and the first thing
  worth writing down is that icons were never failing to scale: everything in
  this app is rem-based, so a `size-4` glyph is 1rem and grows exactly in step
  with the font scale — 16.00px at 100%, 22.39px at 140%, measured. What did not
  move was the RATIO. Body copy is 0.875rem and the two commonest glyph sizes
  are 0.875rem and 0.75rem, so an icon sits at or below the size of the word
  beside it however large the type gets.

  So the first test here pins the thing that was already true, because a future
  change to the spacing scale could quietly break it and nothing else would
  notice. The rest pin the new knob.

  Read-only, like every spec here.
*/
test.use({ storageState: authFile("owner") });

async function register(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tools");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(700);
}

const measure = (page: Page) =>
  page.evaluate(() => {
    const w = (sel: string) => {
      const el = document.querySelector(sel) as SVGElement | null;
      return el ? Number(el.getBoundingClientRect().width.toFixed(2)) : -1;
    };
    return {
      root: getComputedStyle(document.documentElement).fontSize,
      size3: w("main svg.size-3"),
      size35: w("main svg.size-3\\.5"),
      size4: w("main svg.size-4"),
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });

test("icons track the font scale, as rem-based sizing implies", async ({ page }) => {
  await register(page);
  const at100 = await measure(page);
  expect(at100.root).toBe("16px");
  expect(at100.size4).toBe(16);

  await page.evaluate(() => { document.documentElement.style.fontSize = "1.4rem"; });
  await page.waitForTimeout(200);
  const at140 = await measure(page);
  expect(at140.root).toBe("22.4px");
  /* 1rem of a 22.4px root. Not exact to the hundredth in every engine, so this
     asks for the proportion rather than for a literal. */
  expect(at140.size4).toBeGreaterThan(22);
  expect(at140.size4).toBeLessThan(22.5);
});

test("the icon scale grows glyphs and leaves the type alone", async ({ page }) => {
  await register(page);
  const before = await measure(page);

  await page.evaluate(() => { document.documentElement.style.setProperty("--icon-scale", "1.5"); });
  await page.waitForTimeout(200);
  const after = await measure(page);

  /* Every size class the app uses on an <svg> has to be listed in globals.css.
     A class that was missed simply does not move, which is why all three are
     checked rather than one. */
  expect(after.size3).toBeCloseTo(before.size3 * 1.5, 1);
  expect(after.size35).toBeCloseTo(before.size35 * 1.5, 1);
  expect(after.size4).toBeCloseTo(before.size4 * 1.5, 1);

  /* The knob is for icons. If the root font size moved, it is the font scale
     wearing a different label. */
  expect(after.root).toBe(before.root);
});

test("at the largest icon scale the page still does not scroll sideways", async ({ page }) => {
  for (const route of ["/tools", "/people", "/custody", "/jobsites"]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route);
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => { document.documentElement.style.setProperty("--icon-scale", "1.5"); });
    await page.waitForTimeout(500);
    const m = await measure(page);
    /* Wide tables scroll inside their own container; the DOCUMENT must not.
       A glyph half again as large inside a fixed-width control is exactly the
       kind of thing that pushes a toolbar past the viewport. */
    expect(m.docScrollWidth, `${route} scrolls the document sideways`).toBeLessThanOrEqual(
      m.innerWidth + 1,
    );
  }
});

test("the setting is offered on Settings and previews live", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/settings/appearance");
  const select = page.locator("#app-icon-scale");
  await expect(select).toBeVisible({ timeout: 30_000 });

  const iconWidth = () =>
    page.evaluate(() =>
      Number(
        (document.querySelector("#app-icon-scale") as HTMLElement)
          .closest(".grid")!
          .querySelector("svg.size-4")!
          .getBoundingClientRect()
          .width.toFixed(2),
      ),
    );

  /*
    Wait for `preferences.get` to land before touching the control.

    This test failed once in a full run and passed on its own, which is the
    signature of a race rather than of a bug: the form hydrates from the query
    in an effect, and the theme store re-applies the saved preference when it
    does. Selecting before that arrives means the hydration lands on top of the
    selection and the icon snaps back to its saved size.
  */
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);

  const before = await iconWidth();
  await select.selectOption("1.5");
  /* Polled rather than measured once, so this asserts the width the page
     settles on rather than whatever it held 300ms after a click. Preview
     applies through the theme store without a Save — the same contract the
     theme swatches and the font size already have. */
  await expect.poll(iconWidth, { timeout: 5_000 }).toBeCloseTo(before * 1.5, 1);
});
