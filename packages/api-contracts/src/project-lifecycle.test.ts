import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import { PROJECT_STATUSES, type Permission } from "@stinventory/types";
import { projectRouter } from "./routers/project.js";
import { moveCustody } from "./custody.js";
import type { Context } from "./trpc.js";

/*
  STI-105 — a job's status is an enum, and completing one is guarded.

  The guard is the half that matters. `project.status` was a free `text`
  column with `z.string().max(30)` in front of it, so "compleet" was a valid
  status and every screen that switches on it fell through silently. Worse,
  nothing stopped a job being completed while a foreman still held twenty
  tools booked to it — the register kept naming a finished job and the "what
  did this job spend" report stopped matching what was physically on site.

  The count comes from the ACTIVE ASSIGNMENT, not `asset.current_project_id`,
  because the ledger is what gets asked and the projection is derived from it.
  These tests open real custody links through `moveCustody` for exactly that
  reason — asserting against a hand-set projection column would prove nothing
  about the query the guard actually runs.
*/

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("completing a job (STI-105)", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;
  let foremanId: string;

  const ctx = (): Context => ({
    db,
    session: {
      userId,
      tenantId,
      employeeId: null,
      permissions: new Set<Permission>(["project.manage"]),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "sti105-test-secret",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  async function newProject(name: string, status = "active") {
    const [row] = await db
      .insert(schema.project)
      .values({ tenantId, name, status })
      .returning({ id: schema.project.id });
    return row!.id;
  }

  /** A tool held by the foreman AND booked to the job, via a real custody link. */
  async function holdToolOn(projectId: string, tag: string) {
    const [row] = await db
      .insert(schema.asset)
      .values({
        tenantId,
        tag,
        description: `STI-105 ${tag}`,
        currentStatus: "assigned",
        currentCustodianId: foremanId,
        currentProjectId: projectId,
      })
      .returning({ id: schema.asset.id });
    const assetId = row!.id;

    await db.transaction(async (tx) => {
      await moveCustody(tx, {
        tenantId,
        assetId,
        toCustodianId: foremanId,
        projectId,
        locationId: null,
        actorUserId: userId,
      });
    });
    return assetId;
  }

  const statusOf = async (id: string) =>
    (await db.select({ s: schema.project.status }).from(schema.project).where(eq(schema.project.id, id)))[0]?.s;

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-105 lifecycle", slug: `sti105-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: `sti105-${crypto.randomUUID().slice(0, 8)}@test.local`, passwordHash: "not-a-real-hash", firstName: "STI", lastName: "OhFive" })
      .returning({ id: schema.user.id });
    userId = u!.id;
    const [e] = await db
      .insert(schema.employee)
      .values({ tenantId, name: "STI-105 Foreman", role: "foreman" })
      .returning({ id: schema.employee.id });
    foremanId = e!.id;
  });

  afterAll(async () => {
    if (db && tenantId) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("accepts every status the shared enum names", async () => {
    const id = await newProject("STI-105 enum walk", "awarded");
    for (const s of PROJECT_STATUSES) {
      if (s === "complete") continue; // guarded separately below
      await projectRouter.createCaller(ctx()).update({ id, status: s });
      expect(await statusOf(id)).toBe(s);
    }
  });

  it("rejects a status that is not in the enum", async () => {
    const id = await newProject("STI-105 typo probe");
    await expect(
      // @ts-expect-error the point of the enum is that this no longer typechecks either
      projectRouter.createCaller(ctx()).update({ id, status: "compleet" }),
    ).rejects.toThrow();
    /* The DB column is plain text, so nothing below this validation would have
       stopped the write. */
    expect(await statusOf(id)).toBe("active");
  });

  it("REFUSES to complete a job while tools are still out on it, and names them", async () => {
    const id = await newProject("STI-105 busy job");
    await holdToolOn(id, "STI105-A");
    await holdToolOn(id, "STI105-B");

    await expect(projectRouter.createCaller(ctx()).update({ id, status: "complete" })).rejects.toThrow(
      /2 tools are still out on this job/,
    );

    const err = await projectRouter
      .createCaller(ctx())
      .update({ id, status: "complete" })
      .catch((e: Error) => e.message);
    /* Naming them is the difference between a refusal the desk can act on and
       one they have to go hunting behind. */
    expect(err).toContain("STI105-A");
    expect(err).toContain("STI105-B");

    expect(await statusOf(id)).toBe("active");
  });

  it("allows completing once the tools have been moved off", async () => {
    const id = await newProject("STI-105 finishing job");
    const assetId = await holdToolOn(id, "STI105-C");

    await expect(projectRouter.createCaller(ctx()).update({ id, status: "complete" })).rejects.toThrow();

    /* Close the link the way custody actually closes one. */
    await db
      .update(schema.assignment)
      .set({ status: "returned", returnedAt: new Date() })
      .where(eq(schema.assignment.assetId, assetId));

    await projectRouter.createCaller(ctx()).update({ id, status: "complete" });
    expect(await statusOf(id)).toBe("complete");
  });

  it("counts the LEDGER's active link, not the projection column", async () => {
    const id = await newProject("STI-105 projection-only job");
    /* A tool whose projection says it is on the job but which has no active
       custody link. Nobody is holding it, so completing is not blocked — and
       a guard written against `asset.current_project_id` would wrongly refuse. */
    await db.insert(schema.asset).values({
      tenantId,
      tag: "STI105-D",
      description: "STI-105 unheld but booked",
      currentStatus: "available",
      currentProjectId: id,
    });

    await projectRouter.createCaller(ctx()).update({ id, status: "complete" });
    expect(await statusOf(id)).toBe("complete");
  });

  it("lets an already-complete job be edited without re-running the guard", async () => {
    const id = await newProject("STI-105 already done", "complete");
    await holdToolOn(id, "STI105-E");

    /* Re-saving a completed job — renaming it, fixing its cost centre — must
       not be blocked by tools that were already stranded when it closed.
       The guard fires on the TRANSITION into complete, not on the state. */
    await projectRouter.createCaller(ctx()).update({ id, status: "complete", name: "STI-105 already done (renamed)" });
    expect(await statusOf(id)).toBe("complete");
  });
});
