import { test, expect } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  The Cards view can do everything the list can, not just look at it.

  It shipped 2026-09-02 read-only — a card and its sheet could show tools, but
  not who runs the job or how to change a rig, and there was no way to add a
  crew, a PM or a superintendent without switching back to the list. That is
  the gap this closes: the card face gains a plain-text PM/Super line and a
  rig-coverage count, and the sheet gains the real, editable
  `JobsiteTeamStrip`, an "Add crew" action, and `CrewCard` in its `compact`
  layout — the exact same `onPick`/`onAddTools` calls the list wires, so
  neither view can offer an action the other doesn't.

  This spec only proves the actions are REACHABLE — every existing spec here
  is read-only by design (`playwright.config.ts`'s isolation note: a mutating
  spec needs an isolation mechanism this repo doesn't have yet), so it opens
  pickers and closes them with Escape rather than completing an assignment.
*/
test.use({ storageState: authFile("owner") });

async function settled(page: import("@playwright/test").Page) {
  await page.goto("/jobsites");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("section header").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
}

test("the card face shows who runs the job and how rigged it is", async ({ page }) => {
  await settled(page);
  await page.getByRole("group", { name: "Layout" }).getByRole("button", { name: "Cards" }).click();

  // Lone Star is seeded with both a PM (Dana Whitmore) and a superintendent
  // (Marcus Whitfield) — the card face should name both, WITH their employee
  // code, in the same chip style (and abbreviation, "SUP" not "Super") the
  // real team strip in the sheet uses, without opening anything.
  const loneStar = page.getByRole("button", { name: "Open tools on Lone Star" });
  await expect(loneStar).toBeVisible();
  await expect(loneStar.getByText("PM-001 · Dana Whitmore")).toBeVisible();
  await expect(loneStar.getByText("SUP-001 · Marcus Whitfield")).toBeVisible();
  await expect(loneStar.getByText(/\d+\/\d+ with truck & trailer/)).toBeVisible();
});

test("the sheet offers the same crew and roster actions the list does", async ({ page }) => {
  await settled(page);
  await page.getByRole("group", { name: "Layout" }).getByRole("button", { name: "Cards" }).click();
  await page.getByRole("button", { name: "Open tools on Lone Star" }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();

  // The real, editable team strip — not the face's plain text. Matched by
  // the strip's own "EXT-ID · Name" chip text, not the bare name: a
  // superintendent can also hold tools as a crew foreman (CUSTODIAN_ROLES
  // since 2026-09-01), so "Marcus Whitfield" alone matches twice on this
  // sheet — once as the strip's chip, once as a crew's PersonChip — and
  // that ambiguity is real data, not a rendering bug.
  await expect(sheet.getByText("PM-001 · Dana Whitmore")).toBeVisible();
  await expect(sheet.getByText("SUP-001 · Marcus Whitfield")).toBeVisible();

  // A crew row rendered by CrewCard (compact), not the old hand-rolled
  // <section> — its rig slots and per-crew ⋯ menu are the tell.
  const crewMenu = sheet.getByRole("button", { name: /^Actions for / }).first();
  await expect(crewMenu).toBeVisible();
  await crewMenu.click();
  await expect(page.getByText(/Change truck|Assign truck/)).toBeVisible();
  await expect(page.getByText("Move this crew to another job")).toBeVisible();
  await page.keyboard.press("Escape");

  // "Add crew" reaches the real RigPicker and nothing else closes with it.
  await sheet.getByRole("button", { name: "Add crew" }).click();
  await expect(page.getByRole("dialog").filter({ hasText: /crew|foreman/i }).last()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeVisible();
});
