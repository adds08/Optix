import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { projectRouter } from "./routers/project.js";
import type { Context } from "./trpc.js";

/*
  A JOB CODE IDENTIFIES A JOB, and nothing enforced that.

  `tbl_entity_project` carried a primary key on `id` and no other uniqueness,
  so a tenant could hold any number of rows with the same code. The dev
  register did: two projects both named "Equipment Yard", one of them job 24002
  — a real job with a foreman and a tool location on it — that had been
  renamed. In a picker those are two identical lines and the only way to tell
  them apart is to open both.

  Two halves, and both are tested here because they fail differently:

    * `assertCodeFree` in routers/project.ts gives the readable CONFLICT that
      names the job already holding the code.
    * `project_code_per_tenant_uq` (migration 0065) makes the rule true even
      when a writer forgets to call the check. Same relationship as
      `assignment_one_active_uq` and custody.ts — the check explains, the index
      guarantees.

  The NULL case is a rule in its own right, not an edge: plenty of real rows
  have no code, and an index that rejected the second of them would be a worse
  bug than the one being fixed.
*/

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("a job code is unique within a tenant", () => {
  let db: Database;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;

  const ctx = (tid = tenantId): Context => ({
    db,
    session: {
      userId,
      tenantId: tid,
      employeeId: null,
      permissions: new Set<Permission>(["project.manage"]),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "code-uq-test-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  const create = (input: Record<string, unknown>, tid = tenantId) =>
    projectRouter.createCaller(ctx(tid)).create(input as never);

  beforeAll(async () => {
    db = createDb(url!);
    const mk = async (label: string) => {
      const [t] = await db
        .insert(schema.tenant)
        .values({ name: label, slug: `codeuq-${crypto.randomUUID().slice(0, 8)}` })
        .returning({ id: schema.tenant.id });
      return t!.id;
    };
    tenantId = await mk("code-uq A");
    otherTenantId = await mk("code-uq B");
    const [u] = await db
      .insert(schema.user)
      .values({
        tenantId,
        email: `codeuq-${crypto.randomUUID().slice(0, 8)}@test.local`,
        passwordHash: "not-a-real-hash",
        firstName: "Code",
        lastName: "Unique",
      })
      .returning({ id: schema.user.id });
    userId = u!.id;
  });

  afterAll(async () => {
    if (!db) return;
    for (const tid of [tenantId, otherTenantId]) {
      if (!tid) continue;
      await db.delete(schema.project).where(eq(schema.project.tenantId, tid));
      await db.delete(schema.user).where(eq(schema.user.tenantId, tid));
      await db.delete(schema.tenant).where(eq(schema.tenant.id, tid));
    }
  });

  it("refuses a second job with the same code, naming the one that holds it", async () => {
    await create({ name: "Equipment Yard", externalId: "24002", startDate: "2025-01-06" });
    await expect(
      create({ name: "Something Else", externalId: "24002", startDate: "2025-01-06" }),
    ).rejects.toThrow(/already used by Equipment Yard/);
  });

  it("treats a differently-cased code as the same code", async () => {
    await create({ name: "Cased", externalId: "URB-2401", startDate: "2025-01-06" });
    await expect(
      create({ name: "Cased Twin", externalId: "urb-2401", startDate: "2025-01-06" }),
    ).rejects.toThrow(/already used by/);
  });

  it("treats a trailing space as the same code, and stores the trimmed form", async () => {
    /* A trailing space is invisible in a list, so " 24010" reading as a
       different job is exactly the failure this whole rule exists to stop. */
    const made = await create({ name: "Trimmed", externalId: "24010 ", startDate: "2025-01-06" });
    expect(made?.code).toBe("24010");
    await expect(
      create({ name: "Trimmed Twin", externalId: "24010", startDate: "2025-01-06" }),
    ).rejects.toThrow(/already used by/);
  });

  it("allows any number of jobs with no code at all", async () => {
    /* NOT an edge case. Several real jobs have no code, and an index that
       rejected the second of them would be worse than the bug it replaced. */
    await expect(create({ name: "No code one", startDate: "2025-01-06" })).resolves.toBeTruthy();
    await expect(create({ name: "No code two", startDate: "2025-01-06" })).resolves.toBeTruthy();
    await expect(
      create({ name: "Blank code", externalId: "", startDate: "2025-01-06" }),
    ).resolves.toBeTruthy();
  });

  it("scopes the rule to one tenant — the same code in another tenant is fine", async () => {
    await create({ name: "Shared code", externalId: "SHARED-1", startDate: "2025-01-06" });
    await expect(
      create({ name: "Shared code elsewhere", externalId: "SHARED-1", startDate: "2025-01-06" }, otherTenantId),
    ).resolves.toBeTruthy();
  });

  it("lets a job keep its own code when it is edited", async () => {
    /* Re-saving a job with the code it already has must not collide with
       itself — the check has to exclude the row being edited. */
    const made = await create({ name: "Self edit", externalId: "SELF-1", startDate: "2025-01-06" });
    const caller = projectRouter.createCaller(ctx());
    await expect(
      caller.update({ id: made!.id, externalId: "SELF-1", name: "Self edit renamed" } as never),
    ).resolves.toBeTruthy();
  });

  it("refuses an edit that takes a code another job already holds", async () => {
    await create({ name: "Holder", externalId: "TAKEN-1", startDate: "2025-01-06" });
    const mover = await create({ name: "Mover", externalId: "MOVER-1", startDate: "2025-01-06" });
    const caller = projectRouter.createCaller(ctx());
    await expect(
      caller.update({ id: mover!.id, externalId: "TAKEN-1" } as never),
    ).rejects.toThrow(/already used by Holder/);
  });

  it("is enforced by the database, not only by the check in front of it", async () => {
    /* The check can be bypassed by any future writer that forgets to call it;
       the partial index cannot. This writes straight past the router on
       purpose — it is the backstop that is under test, not the router. */
    await create({ name: "Backstop", externalId: "BACKSTOP-1", startDate: "2025-01-06" });
    await expect(
      db.insert(schema.project).values({
        tenantId,
        name: "Backstop bypass",
        code: "backstop-1",
        startDate: "2025-01-06",
      }),
    ).rejects.toThrow(/project_code_per_tenant_uq/);
  });
});
