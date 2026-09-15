/*
  Create a small tool, and land it in the Equipment Yard.

    sign in  ->  Small tools  ->  New tool  ->  description, make, model
             ->  leave the code blank (it is generated)  ->  Create
             ->  find it in the register by its new code  ->  the Yard tab

  Two things this flow has to get right, because they are what people ask about.

  1. There is no "Equipment Yard" field, and no yard location to pick. In this
     product the yard is the ABSENCE of a job and a holder: a tool nobody is
     carrying and no job is paying for is in the yard by definition. The register
     says so itself — the new row reads "In the yard" — which is why the proof is
     that row and the Yard tab, not the dialog the tool was created in.

  2. The register's search does NOT cover the description. It matches code, make
     and serial (its own placeholder says "tag, model or serial"), and the table's
     TOOL column renders make + model number — never the description. So this flow
     captures the generated code from the create response and searches that.
     Searching for the typed description is how it failed first, with a bare
     "No rows match the search".

  Recorded against the running app, so it fails if code generation stops, the
  duplicate check refuses, or the tool never reaches the register.
*/
export default {
  name: "create-small-tool",
  title: "Create a small tool, from sign-in to the register",
  intro:
    "Adding a tool the register has never seen, from the sign-in screen to the row it creates — " +
    "and what \"in the yard\" does and does not mean. Recorded against the running app.",

  async run(t) {
    const { page } = t;

    /* ---- 1. the way in ---- */
    await t.step({
      selector: "#email",
      arrow: "left",
      text: "Sign in with the account you use at the yard desk.",
      hold: 1400,
    });
    await t.type("#email", "tutorial@optixtec.com");

    await t.step({
      selector: "#password",
      arrow: "left",
      text: "And its password — accounts are personal, nobody borrows one.",
      hold: 1200,
    });
    await t.type("#password", process.env.TUTORIAL_PASSWORD ?? "TutorialDemo2026");

    await t.step({ selector: 'button[type="submit"]', arrow: "left", text: "Sign in.", hold: 1200 });
    await t.click('button[type="submit"]');
    /* Signed in when the SPA's path says so.
       NOT `waitForURL(/home/)` — that waits on the document's `load` event, and
       this shell never fires another one, because signing in is a client-side
       navigation. The same wait that worked all morning hung this afternoon.
       Polling `location.pathname` states the actual condition. */
    await page.waitForFunction(() => location.pathname === "/home", null, { timeout: 25000 });
    await t.pause(1300);

    /* ---- 2. the register ----
       Straight to the route rather than clicking through the module rail. The
       shell is two panes — the rail picks the module and the sidebar lists only
       THAT module's screens — so there is no `/tools` link in the DOM at all
       while Home is the active module. Waiting for one is a 30s timeout, which
       is how this flow failed. The sidebar entry is annotated on arrival, so the
       video still shows where it lives. */
    await t.goto("/tools");
    await t.waitFor('[aria-label="Search tools"]');
    await t.pause(800);
    await t.step({
      selector: 'a[href="/tools"]',
      arrow: "left",
      text: "Small tools lives under Equipment — one register for every tool the company owns.",
      hold: 1700,
    });

    /* ---- 3. a new tool ---- */
    const newTool = page.getByRole("button", { name: "New tool" });
    await t.step({
      target: newTool,
      text: "New tool. What you add here is in the register immediately — no import, no waiting.",
      hold: 1500,
    });
    await t.click(newTool);
    await t.waitFor("#asset-description");
    await t.pause(600);

    /* ---- 4. what it is ---- */
    await t.step({
      selector: "#asset-description",
      arrow: "left",
      text: "A description is the one thing the form insists on — make or description, either is enough.",
      hold: 1400,
    });
    await t.type("#asset-description", "Rotary Hammer");

    await t.step({
      selector: "#asset-make",
      arrow: "left",
      text: "The make, so the register reads like the shelf it came off.",
      hold: 1100,
    });
    await t.type("#asset-make", "Bosch");

    await t.step({
      selector: "#asset-model",
      arrow: "left",
      text: "And the model number — this is what the register shows beside the code, so the desk can tell two Bosch tools apart.",
      hold: 1500,
    });
    await t.type("#asset-model", "GBH 2-26");

    /* ---- 5. the code is generated ---- */
    await t.step({
      selector: "#asset-code",
      arrow: "left",
      text: "Leave the code blank and Optix mints the next one. Nobody has to invent an identifier, and no two tools can share one.",
      hold: 2000,
    });

    /* ---- 6. create, and catch the code it minted ----
       The generator owns the number, so the flow reads it from the create
       response rather than assuming one. A hardcoded TOOL-00754 would be wrong
       on the very next run — and this runs against a live register. */
    const create = page.locator('[role="dialog"]').getByRole("button", { name: "Create" });
    await t.step({ target: create, text: "Create.", hold: 1200 });

    const responsePromise = page.waitForResponse(async (r) => {
      if (r.request().method() !== "POST" || !r.url().includes("/trpc/")) return false;
      try { return /TOOL-\d+/.test(await r.text()); } catch { return false; }
    }, { timeout: 25000 });
    await t.click(create);
    let code = null;
    try {
      const body = await (await responsePromise).text();
      code = (body.match(/TOOL-\d+/) ?? [])[0];
    } catch { /* fall through to the search below, which will fail loudly */ }
    if (!code) throw new Error("could not read the generated code from the create response");
    await t.pause(1600);

    /* ---- 7. find it in the register ---- */
    await t.type('[aria-label="Search tools"]', code);
    await t.pause(1100);

    const newRow = page.locator("tr", { hasText: code }).first();
    await t.step({
      target: newRow,
      text: `There it is: ${code}. Available, held by nobody, and no job paying for it — the three things that add up to "in the yard".`,
      hold: 2400,
    });

    /* ---- 8. where "the yard" actually lives ----
       Corrected after watching the first cut. The Yard tab counts tools with a
       WAREHOUSE LOCATION and no custodian. The register's "In the yard" is the
       HOLDER column saying nobody is holding it — a different question from
       where it physically sits, which is the WHERE column, and that is "—".

       So a brand-new tool is NOT counted in the Yard card. The first version of
       this flow said it was, and the still proved it wrong: 0 tools.
       The honest version is also the more useful one, because it is the
       distinction the desk actually needs. */
    await t.goto("/jobsites");
    await t.pause(1100);

    const yardTab = page.getByRole("button", { name: "Yard" });
    await t.step({
      target: yardTab,
      text: "Tools by Jobsite splits into Projects, Yard and Unassigned. The Yard counts tools recorded at a warehouse location.",
      hold: 1900,
    });
    await t.click(yardTab);
    await t.pause(1300);

    /* By its code, not its name: "Equipment Yard" also appears in the job
       filter's option list, so a text match can land on the wrong element. */
    const yardCard = page.getByText("URB-YARD").first();
    await t.step({
      target: yardCard,
      text: "And it is empty — no warehouse location has been recorded yet, so nothing is counted here. \"In the yard\" on the register means nobody holds it; it does not mean a place has been set.",
      hold: 2800,
    });
  },
};
