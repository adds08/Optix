import { test, expect } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  The CSV export actually produces a file.

  `downloadCsv` (apps/web/lib/csv.ts) is the ONLY download path in the product —
  report tables, the Tool Register export and the import template all end up
  there — so a fault in it takes out every export button at once, and there was
  no test of any kind on that path before this one.

  **Be clear about what this does NOT prove.** It was written alongside a fix
  for two defects in that function (an anchor never appended to the document,
  and an object URL revoked synchronously with the click), and it does not catch
  either of them: run it against the unfixed code and it still passes. Chromium
  follows a detached anchor happily, and the revoke race did not fire. That was
  measured, not assumed — the pre-fix version was restored and this spec run
  against it before the comment was written.

  Catching the detached-anchor defect needs a Gecko project in
  `playwright.config.ts`, which is a bigger decision than this change: the suite
  is Chromium-only on purpose, because everything else it asserts is
  engine-independent and three browsers would triple the runtime to re-prove the
  same routing.

  What it IS worth: the export path is now exercised end to end by something,
  so a change that breaks downloading outright — a thrown handler, a disabled
  button, an empty body — fails here instead of reaching a user.

  READ-ONLY, like every spec here (see the isolation note in
  `playwright.config.ts`). Exporting mutates nothing — it reads a report and
  serialises the rows it already fetched — so this does not need the isolation
  mechanism STI-002 is waiting on.

  `needs-tag` is the report chosen deliberately: it is the one whose rows the
  seed only started producing once untagged tools were added for UI-68. Before
  that it was empty on every machine, its export button correctly disabled, and
  this whole path unexercisable — which is the trap that produced UI-68 and
  UI-69 in the first place.
*/
test.describe("report CSV export", () => {
  test.use({ storageState: authFile("owner") });

  test("downloads a file when the report has rows", async ({ page }) => {
    await page.goto("/reports/needs-tag");

    const exportButton = page.getByRole("button", { name: /export csv/i });
    await expect(exportButton).toBeVisible();

    /* If this is disabled the report came back empty, which means the seed
       stopped producing untagged tools — a different regression, and one worth
       failing loudly for rather than skipping past. */
    await expect(exportButton).toBeEnabled();

    const download = await Promise.all([
      page.waitForEvent("download"),
      exportButton.click(),
    ]).then(([d]) => d);

    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    /* Read the body rather than trusting the event. A download can be reported
       and still arrive empty, which is the shape a revoked object URL would
       take if the race ever did fire. */
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");

    expect(body.length).toBeGreaterThan(0);
    /* A header row at minimum, and one data row, since the button was enabled. */
    expect(body.split("\n").length).toBeGreaterThan(1);
  });
});
