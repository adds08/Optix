import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { dashboardRouter } from "./routers/dashboard.js";
import type { Context } from "./trpc.js";

/*
  The "In maintenance" KPI tile is the whole shop-workflow family
  (in_maintenance/diagnosing/waiting_parts/ready_for_pickup) summed as one
  number, same as project-monitor.tsx's shopAndYard wallboard tile. A tool
  mid-repair hasn't come back into service on any of these statuses, and
  undercounting by staying literal to `in_maintenance` would read as tools the
  desk lost track of.

  Throwaway tenant, real Postgres via DATABASE_URL (skipped without it) — same
  harness shape as asset-create.test.ts, needed here because the assertion is
  an exact count and the seeded tenant's counts move as the seed changes.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("dashboard.kpis sums the maintenance-family statuses", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;

  const makeCtx = (): Context => ({
    db,
    session: {
      userId,
      tenantId,
      employeeId: null,
      permissions: new Set<Permission>(["asset.read", "assets.view.all"]),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "sti-dashboard-kpi-test-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "Dashboard KPI test", slug: `dash-kpi-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: "dashkpi@test.local", passwordHash: "not-a-real-hash", firstName: "Dash", lastName: "Kpi" })
      .returning({ id: schema.user.id });
    userId = u!.id;

    /* One asset per maintenance-family status, plus one control asset that
       must NOT be counted. */
    await db.insert(schema.asset).values([
      { tenantId, description: "in_maintenance drill", currentStatus: "in_maintenance" },
      { tenantId, description: "diagnosing drill", currentStatus: "diagnosing" },
      { tenantId, description: "waiting_parts drill", currentStatus: "waiting_parts" },
      { tenantId, description: "ready_for_pickup drill", currentStatus: "ready_for_pickup" },
      { tenantId, description: "available drill", currentStatus: "available" },
    ]);
  });

  afterAll(async () => {
    if (db && tenantId) {
      await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
    }
    await db?.$client.end();
  });

  it("counts all four maintenance-family statuses as one number", async () => {
    const kpis = await dashboardRouter.createCaller(makeCtx()).kpis();
    expect(kpis.inMaintenance).toBe(4);
  });
});
