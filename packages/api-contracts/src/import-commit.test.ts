import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { importRouter } from "./routers/import.js";
import type { Context } from "./trpc.js";

/*
  STI-405, the half the pure tests cannot reach — criteria 3, 4 and 5.

  `import-validation.test.ts` covers the CHECKING: is this cell a date, is
  `USED` a condition we know, are two rows claiming one tag. All pure, no
  database. This file covers the WRITING, and the three properties that only
  exist once a transaction is involved:

    3. **Preview equals commit.** The preview's promise has to match what
       commit does. A preview that says "137 rows are fine" and then writes 130
       has lied, and a preview people stop trusting is worse than no preview at
       all — they skip it, and the errors arrive as a half-imported register.

    4. **A failed row rolls back the whole commit.** All or nothing. Half a
       spreadsheet is the worst outcome available: the file cannot be re-run
       (the first half are now duplicates) and nobody can tell from the outside
       where it stopped.

    5. **One case per entity.** Five specs exist — asset, employee, project,
       location, vehicle — and the validation tests exercised a spec invented
       for the test. A spec whose insert path is wrong fails only for its own
       entity, which is exactly the failure a single generic test misses.

  Why this is worth the database time rather than being left as "probably
  fine": **Phase 4's Foundation loader (STI-403) reuses this transactional
  pattern**, and a one-time load of somebody else's accounting system is the
  worst possible place to discover that a partial failure does not roll back.

  Real Postgres via DATABASE_URL, throwaway tenant, cleaned up after.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("spreadsheet import: the commit path (STI-405)", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;
  let projectName: string;

  const suffix = crypto.randomUUID().slice(0, 8);

  /* Every import permission, so a refusal in these tests is a real one rather
     than a missing grant. The permission gate itself is covered by the RBAC
     matrix test's "every mutation carries a permission" walk. */
  const ctx = (): Context => ({
    db,
    session: {
      userId,
      tenantId,
      employeeId: null,
      permissions: new Set<Permission>([
        "asset.manage", "employee.manage", "project.manage",
        "location.manage", "vehicle.manage",
      ]),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "sti405-test-secret",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  const caller = () => importRouter.createCaller(ctx());

  const countOf = async (table: any) =>
    Number(
      (await db.select({ c: sql<number>`count(*)::int` }).from(table).where(eq(table.tenantId, tenantId)))[0]?.c ?? 0,
    );

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-405 import test", slug: `sti405-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;

    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: `sti405-${suffix}@test.local`, passwordHash: "x", firstName: "Im", lastName: "Port" })
      .returning({ id: schema.user.id });
    userId = u!.id;

    /* A project for the `ref` columns to resolve against — `employee` and
       `location` both point at one by NAME, which is the whole reason ref
       resolution exists. */
    projectName = `STI405 Job ${suffix}`;
    await db.insert(schema.project).values({ tenantId, name: projectName });
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* Asset imports write ledger rows, and the cascade needs the sanctioned
         transactional trigger disable (0014). */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  // ---------------------------------------------------------------------------
  // Criterion 3 — preview equals commit
  // ---------------------------------------------------------------------------

  describe("the preview predicts exactly what commit does", () => {
    it("promises N good rows and writes N", async () => {
      const rows = [
        { name: `P1 ${suffix}`, cost_code: `C1-${suffix}` },
        { name: `P2 ${suffix}`, cost_code: `C2-${suffix}` },
        { name: `P3 ${suffix}`, cost_code: `C3-${suffix}` },
      ];

      const preview = await caller().preview({ entity: "project", rows });
      expect(preview.summary.bad).toBe(0);
      expect(preview.summary.ok).toBe(3);

      const before = await countOf(schema.project);
      const result = await caller().commit({ entity: "project", rows });

      /* The number the user was shown, the number commit reports, and the
         number of rows that actually appeared — all three, because any two
         agreeing is not the property. */
      expect(result.imported).toBe(preview.summary.ok);
      expect(await countOf(schema.project)).toBe(before + preview.summary.ok);
    });

    it("refuses the commit when the preview found a bad row, and says how many", async () => {
      /* The preview is not advisory. If it found errors, commit must refuse
         rather than import "the good ones" — a partial import from a file the
         user was told was broken is the same half-written register by a
         different route. */
      const rows = [
        { name: `Good ${suffix}`, cost_code: `OK-${suffix}` },
        { name: "", cost_code: `BAD-${suffix}` }, // name is required
      ];

      const preview = await caller().preview({ entity: "project", rows });
      expect(preview.summary.bad).toBe(1);

      const before = await countOf(schema.project);
      await expect(caller().commit({ entity: "project", rows })).rejects.toThrow(/1 of 2 rows are still invalid/);
      /* "Nothing was imported" is what the message promises. Assert it. */
      expect(await countOf(schema.project)).toBe(before);
    });

    it("re-validates at commit rather than trusting the preview it was handed", async () => {
      /*
        The preview and the commit are two round trips, and the database can
        change between them. A row that previewed clean can duplicate something
        created in the meantime, so `commit` runs `prepare` again rather than
        accepting the client's earlier verdict — otherwise the preview becomes
        a token a client could forge.
      */
      const rows = [{ name: `Race ${suffix}`, cost_code: `RACE-${suffix}` }];

      const preview = await caller().preview({ entity: "project", rows });
      expect(preview.summary.bad).toBe(0);

      /* Somebody else creates the same cost code between preview and commit. */
      await db.insert(schema.project).values({ tenantId, name: "Interloper", externalId: `RACE-${suffix}` });

      await expect(caller().commit({ entity: "project", rows })).rejects.toThrow(/still invalid/);
    });
  });

  // ---------------------------------------------------------------------------
  // Criterion 4 — a failed row rolls back the whole commit
  // ---------------------------------------------------------------------------

  describe("a failure part-way through undoes the whole import", () => {
    /*
      **A finding first, because it changes what these tests can honestly
      claim.** There is currently NO input that passes validation and then
      fails at insert. Checked against the live schema: the only unique
      constraint on the five importable tables is `vehicle (id, vehicle_type)`,
      which an import cannot violate because `id` is generated. Every other
      rule the database would enforce, the validator already enforces first —
      required columns, enums, refs resolved to real rows, duplicates within
      the file and against existing ones.

      That is a good state to be in, and it means the end-to-end property
      ("row 88 fails, rows 1-87 vanish") cannot be driven from the public API
      today. Faking it by planting a constraint for the test would prove the
      test's own fixture rolls back, not the importer.

      So the property is pinned from two directions instead, and what each one
      covers is stated rather than implied:

        1. `commit` WRAPS its inserts in `db.transaction` — asserted against
           the source, because that wrapper is the entire mechanism and
           removing it is the regression this ticket exists to prevent.
        2. That wrapper genuinely undoes committed work — asserted against real
           Postgres, including the asset+ledger pair, which is the case where
           a leak could not be cleaned up afterwards.

      **This stops being true the moment Phase 4 lands.** STI-403's Foundation
      loader reuses this pattern and will write rows the validator does not
      model — at which point a validator-passing row CAN fail at insert, and
      the end-to-end test becomes both possible and necessary. Written down
      here so whoever builds it knows why it was not written now.
    */

    it("wraps its inserts in a transaction at all", () => {
      /*
        A source assertion, deliberately. The realistic regression is somebody
        making the loop "resilient" — catching per row so one bad line does not
        lose the file — which reads like an improvement and converts
        all-or-nothing into a half-imported spreadsheet that cannot be re-run.
        No behavioural test can catch that while no input can fail.
      */
      const src = readFileSync(new URL("./routers/import.ts", import.meta.url).pathname, "utf8");
      const commit = src.slice(src.indexOf("  commit:"), src.indexOf("async function insertOne"));

      expect(commit, "commit no longer wraps its inserts in a transaction").toContain("db.transaction");
      /* A try/catch around the per-row insert would swallow the failure and
         defeat the transaction it sits inside. */
      expect(commit.includes("catch"), "commit swallows a per-row failure — that is not all-or-nothing").toBe(false);
    });

    it("undoes rows already written when a later statement throws", async () => {
      /* The mechanism `commit` depends on, against the real database. Two
         inserts in one transaction, the second throws, neither survives. */
      const before = await countOf(schema.project);

      await expect(
        db.transaction(async (tx) => {
          await tx.insert(schema.project).values({ tenantId, name: `Rollback A ${suffix}` });
          await tx.insert(schema.project).values({ tenantId, name: `Rollback B ${suffix}` });
          throw new Error("import failed on a later row");
        }),
      ).rejects.toThrow(/later row/);

      expect(await countOf(schema.project), "a rolled-back import left rows behind").toBe(before);
    });

    it("leaves no orphan ledger event when an asset import rolls back", async () => {
      /*
        The sharpest case, and the reason this matters more than tidiness:
        `insertOne` writes the asset AND its genesis `tag` event. The ledger is
        append-only by trigger, so an event that outlived its asset could never
        be deleted — a permanent row referencing something that does not exist.
      */
      const beforeAssets = await countOf(schema.asset);
      const beforeEvents = await countOf(schema.transaction);

      await expect(
        db.transaction(async (tx) => {
          const [a] = await tx
            .insert(schema.asset)
            .values({ tenantId, tag: `ORPHAN-${suffix}`, currentStatus: "available", createdBy: userId })
            .returning({ id: schema.asset.id });
          await tx.insert(schema.transaction).values({
            tenantId, assetId: a!.id, eventType: "tag", actorId: userId,
            toState: { status: "available", custodianId: null, projectId: null, locationId: null },
            refType: "manual",
          });
          throw new Error("import failed on a later row");
        }),
      ).rejects.toThrow(/later row/);

      expect(await countOf(schema.asset)).toBe(beforeAssets);
      expect(await countOf(schema.transaction), "a ledger event outlived its asset").toBe(beforeEvents);
    });
  });

  // ---------------------------------------------------------------------------
  // Criterion 5 — one case per entity
  // ---------------------------------------------------------------------------

  describe("every entity's insert path actually works", () => {
    /* A wrong insert path fails only for its own entity, which is exactly what
       a single generic test misses. Five specs, five commits. */

    it("asset — and writes the genesis ledger event", async () => {
      const before = await countOf(schema.asset);
      const res = await caller().commit({
        entity: "asset",
        rows: [{ tag: `E-ASSET-${suffix}`, description: "Imported hammer drill", quantity: "1" }],
      });
      expect(res.imported).toBe(1);
      expect(await countOf(schema.asset)).toBe(before + 1);

      /* Without the event the tool has a projection and no origin, the fold
         has nothing to rebuild from, and the reconciliation sweep reports it
         as `no_evidence` forever. */
      const [ev] = await db
        .select({ id: schema.transaction.id, eventType: schema.transaction.eventType })
        .from(schema.transaction)
        .innerJoin(schema.asset, eq(schema.asset.id, schema.transaction.assetId))
        .where(and(eq(schema.asset.tenantId, tenantId), eq(schema.asset.tag, `E-ASSET-${suffix}`)));
      expect(ev, "an imported tool has no ledger event").toBeTruthy();
      expect(ev!.eventType).toBe("tag");
    });

    it("employee — and records the initial posting when one is named", async () => {
      const before = await countOf(schema.employee);
      const res = await caller().commit({
        entity: "employee",
        rows: [{ name: `Imported Person ${suffix}`, employee_id: `EMP-${suffix}`, primary_project: projectName }],
      });
      expect(res.imported).toBe(1);
      expect(await countOf(schema.employee)).toBe(before + 1);

      /* Mirrors `employee.create`, so a person imported from a spreadsheet has
         the same history as one typed in — the posting is what makes the
         charging history answerable later. */
      expect(await countOf(schema.employeeProjectAssignment)).toBeGreaterThan(0);
    });

    it("project", async () => {
      const before = await countOf(schema.project);
      const res = await caller().commit({
        entity: "project",
        rows: [{ name: `Imported Job ${suffix}`, cost_code: `IMP-${suffix}` }],
      });
      expect(res.imported).toBe(1);
      expect(await countOf(schema.project)).toBe(before + 1);
    });

    it("location — resolving its project by NAME", async () => {
      const before = await countOf(schema.location);
      const res = await caller().commit({
        entity: "location",
        rows: [{ name: `Imported Box ${suffix}`, type: "gang_box", project: projectName }],
      });
      expect(res.imported).toBe(1);
      expect(await countOf(schema.location)).toBe(before + 1);

      /* Ref resolution is the half a spreadsheet cannot do for itself: the
         file says "STI405 Job", the database needs a uuid. */
      const [row] = await db
        .select({ projectId: schema.location.projectId })
        .from(schema.location)
        .where(and(eq(schema.location.tenantId, tenantId), eq(schema.location.name, `Imported Box ${suffix}`)));
      expect(row!.projectId, "the project name did not resolve to an id").toBeTruthy();
    });

    it("vehicle", async () => {
      const before = await countOf(schema.vehicle);
      const res = await caller().commit({
        entity: "vehicle",
        rows: [{ unit: `IMP-VEH-${suffix}`, type: "trailer" }],
      });
      expect(res.imported).toBe(1);
      expect(await countOf(schema.vehicle)).toBe(before + 1);
    });
  });
});
