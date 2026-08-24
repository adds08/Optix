import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { locationRouter } from "./routers/location.js";
import type { Context } from "./trpc.js";

/*
  STI-502 — one truck per foreman, enforced at the database.

  Two layers, and both are tested here because they fail differently:

    1. `vehicle_one_truck_per_foreman_uq` (migration 0022) is the GUARANTEE.
       It fires no matter which code path writes, including a direct UPDATE —
       which is exactly what the first test does, because a control that only
       holds when the application is well-behaved is not a control.

    2. The check in `location.setCustodian` is the MESSAGE. The index alone
       surfaces as an unreadable INTERNAL_SERVER_ERROR; the ticket asks for
       "an error naming the current holder", and a constraint cannot name
       anything.

  TRAILERS ARE DELIBERATELY NOT CONSTRAINED, and the last test pins that so
  nobody "fixes" it later: Urban's real data has FELIPE PORTILLO holding
  TE-017 and TE-027, both loaded. See the schema comment and STI-502.
*/

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("a foreman drives one truck (STI-502)", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;
  let foremanId: string;
  let otherForemanId: string;
  let truckA: { vehicleId: string; locationId: string };
  let truckB: { vehicleId: string; locationId: string };

  const ctx = (): Context => ({
    db,
    session: {
      userId,
      tenantId,
      employeeId: null,
      permissions: new Set<Permission>(["location.manage"]),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "sti502-test-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  async function newVehicle(
    unit: string,
    vehicleType: "truck" | "trailer",
    custodianId: string | null = null,
    ownershipType: "company_owned" | "personal_allowance" = "company_owned",
  ) {
    const [loc] = await db
      .insert(schema.location)
      .values({ tenantId, type: "vehicle", name: unit, custodianEmployeeId: custodianId })
      .returning({ id: schema.location.id });
    const [v] = await db
      .insert(schema.vehicle)
      .values({ tenantId, locationId: loc!.id, vehicleType, unit, ownershipType, foremanEmployeeId: custodianId })
      .returning({ id: schema.vehicle.id });
    return { vehicleId: v!.id, locationId: loc!.id };
  }

  const foremanOfVehicle = async (id: string) =>
    (await db.select({ f: schema.vehicle.foremanEmployeeId }).from(schema.vehicle).where(eq(schema.vehicle.id, id)))[0]?.f ?? null;

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-502 rig", slug: `sti502-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: `sti502-${crypto.randomUUID().slice(0, 8)}@test.local`, passwordHash: "not-a-real-hash", firstName: "STI", lastName: "FiveOhTwo" })
      .returning({ id: schema.user.id });
    userId = u!.id;

    const [e1] = await db.insert(schema.employee).values({ tenantId, name: "STI-502 Foreman", role: "foreman" }).returning({ id: schema.employee.id });
    foremanId = e1!.id;
    const [e2] = await db.insert(schema.employee).values({ tenantId, name: "STI-502 Other Foreman", role: "foreman" }).returning({ id: schema.employee.id });
    otherForemanId = e2!.id;

    truckA = await newVehicle("STI502-TRUCK-A", "truck", foremanId);
    truckB = await newVehicle("STI502-TRUCK-B", "truck", null);
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

  it("the DATABASE refuses a second truck for the same foreman, whatever writes it", async () => {
    /* A raw UPDATE, deliberately bypassing every application check. This is
       what makes the index a guarantee rather than a convention. */
    await expect(
      db
        .update(schema.vehicle)
        .set({ foremanEmployeeId: foremanId })
        .where(eq(schema.vehicle.id, truckB.vehicleId)),
    ).rejects.toThrow(/vehicle_one_truck_per_foreman_uq/);

    expect(await foremanOfVehicle(truckB.vehicleId)).toBeNull();
  });

  it("setCustodian refuses with a message NAMING the truck they already have", async () => {
    const err = await locationRouter
      .createCaller(ctx())
      .setCustodian({ locationId: truckB.locationId, custodianEmployeeId: foremanId, moveContents: false })
      .catch((e: Error) => e.message);

    /* The unit, not just "a conflict" — the desk has to know which truck to
       detach, and going to look it up is the friction this replaces. */
    expect(err).toContain("STI502-TRUCK-A");
    expect(err).toMatch(/already has truck/i);
    expect(await foremanOfVehicle(truckB.vehicleId)).toBeNull();
  });

  it("re-assigning the truck they already hold is a no-op, not a conflict", async () => {
    /* The index would not fire here either — the row is already theirs. A
       naive "do they have a truck?" check would wrongly refuse. */
    await locationRouter
      .createCaller(ctx())
      .setCustodian({ locationId: truckA.locationId, custodianEmployeeId: foremanId, moveContents: false });

    expect(await foremanOfVehicle(truckA.vehicleId)).toBe(foremanId);
  });

  it("a DIFFERENT foreman may take the free truck", async () => {
    await locationRouter
      .createCaller(ctx())
      .setCustodian({ locationId: truckB.locationId, custodianEmployeeId: otherForemanId, moveContents: false });

    expect(await foremanOfVehicle(truckB.vehicleId)).toBe(otherForemanId);

    /* Put it back so the fixture is reusable. */
    await locationRouter
      .createCaller(ctx())
      .setCustodian({ locationId: truckB.locationId, custodianEmployeeId: null, moveContents: false });
  });

  it("handing a truck BACK is always allowed — NULLs must not collide", async () => {
    const spare = await newVehicle("STI502-TRUCK-C", "truck", null);
    const spare2 = await newVehicle("STI502-TRUCK-D", "truck", null);
    /* Two unheld trucks is the yard's normal resting state. A non-partial
       unique index would have made the second one impossible. */
    expect(await foremanOfVehicle(spare.vehicleId)).toBeNull();
    expect(await foremanOfVehicle(spare2.vehicleId)).toBeNull();
  });

  it("a foreman may draw a PERSONAL truck AND drive a company one", async () => {
    /*
      The case that caught the first cut of this index. departure.test.ts
      builds exactly this foreman, because it is the entire premise of
      STI-306: on departure the company truck is reassigned and the personal
      one leaves with the person. An index across both ownership types
      forbids the arrangement the departure logic exists to handle — it broke
      that suite, which is how the narrowing was found rather than shipped.
    */
    const personal = await newVehicle("STI502-TRUCK-PERSONAL", "truck", foremanId, "personal_allowance");
    expect(await foremanOfVehicle(personal.vehicleId)).toBe(foremanId);
    /* And they still hold their company truck. */
    expect(await foremanOfVehicle(truckA.vehicleId)).toBe(foremanId);
  });

  it("setCustodian does not block a personal truck for someone who has a company one", async () => {
    const personal2 = await newVehicle("STI502-TRUCK-PERSONAL-2", "truck", null, "personal_allowance");
    /* The application check is narrowed the same way as the index; if the two
       ever drift, this is the test that says so. */
    await locationRouter
      .createCaller(ctx())
      .setCustodian({ locationId: personal2.locationId, custodianEmployeeId: foremanId, moveContents: false });

    expect(await foremanOfVehicle(personal2.vehicleId)).toBe(foremanId);
  });

  it("TRAILERS are deliberately unconstrained — Urban really does run two per foreman", async () => {
    const t1 = await newVehicle("STI502-TRAILER-A", "trailer", foremanId);
    const t2 = await newVehicle("STI502-TRAILER-B", "trailer", foremanId);

    /* If this ever starts failing, someone has added the trailer half of the
       index. Before "fixing" this test, read the STI-502 schema comment:
       FELIPE PORTILLO holds TE-017 (22 tools) and TE-027 (30 tools) in the
       imported tools list, and his posting note says so. The constraint would
       fail the migration on correct production data. */
    expect(await foremanOfVehicle(t1.vehicleId)).toBe(foremanId);
    expect(await foremanOfVehicle(t2.vehicleId)).toBe(foremanId);
  });

  it("the constraint is per tenant — two tenants may each have a foreman with a truck", async () => {
    const [t2] = await db
      .insert(schema.tenant)
      .values({ name: "STI-502 second tenant", slug: `sti502b-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    const otherTenant = t2!.id;
    try {
      const [emp] = await db
        .insert(schema.employee)
        .values({ tenantId: otherTenant, name: "Their foreman", role: "foreman" })
        .returning({ id: schema.employee.id });
      const [loc] = await db
        .insert(schema.location)
        .values({ tenantId: otherTenant, type: "vehicle", name: "THEIR-TRUCK" })
        .returning({ id: schema.location.id });
      const [v] = await db
        .insert(schema.vehicle)
        .values({
          tenantId: otherTenant,
          locationId: loc!.id,
          vehicleType: "truck",
          unit: "THEIR-TRUCK",
          foremanEmployeeId: emp!.id,
        })
        .returning({ id: schema.vehicle.id });
      expect(v!.id).toBeTruthy();
    } finally {
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, otherTenant));
        await tx.execute(sql`ALTER TABLE "transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
  });
});
