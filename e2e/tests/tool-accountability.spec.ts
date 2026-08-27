import { test, expect } from "@playwright/test";
import { authFile } from "../roles.js";

/*
  A tool backtracks to the people accountable for it.

  Custody answers "who is holding this" and stops there. On a job the next two
  questions are "who is their superintendent" and "who is the PM", and until
  2026-08-28 a tool could answer neither — the chain existed as
  `project_team_member` rows and nothing joined a tool to it.

  The property worth pinning is that the chain is DERIVED, not stored. A tool
  follows its custodian, the custodian's project follows them, and the team
  follows the project, so moving a superintendent off a job changes what every
  tool on that job reports with nothing to re-sync. This walks the real screen
  rather than asserting on a fixture: a stored copy would satisfy a unit test
  and drift in production.

  Read-only, like every spec here.
*/
test.use({ storageState: authFile("owner") });

/* `dt` + the following `dd` — the shape `Field` renders. Addressed this way
   because the label alone matches the <dt> and tells you nothing about the
   value beside it, which is the half under test. */
function fieldValue(page: import("@playwright/test").Page, label: string) {
  return page.locator(`dt:text-is("${label}") + dd`);
}

test("a tool on a job names its superintendent and PM", async ({ page }) => {
  await page.goto("/tools");

  /* Rows carry the project name, so pick one on a job with a staffed team
     rather than deep-linking a uuid — a hard-coded id makes the spec a test of
     the seed. The tag cell is the link; clicking the row itself does nothing. */
  const row = page.locator("table tbody tr", { hasText: "Lone Star" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("link").first().click();

  await expect(page).toHaveURL(/\/tools\/[0-9a-f-]{36}/);

  /* Both must resolve to a NAME. An em dash means the lookup returned nothing
     and the screen rendered its empty state, which is the failure this exists
     to catch — it looks identical to a tool nobody is accountable for. */
  await expect(fieldValue(page, "Superintendent")).not.toHaveText("—");
  await expect(fieldValue(page, "Project manager")).not.toHaveText("—");
});
