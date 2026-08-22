import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import { VEHICLE_OWNERSHIP } from "@stinventory/types";
import { moveCustody } from "./custody.js";
import {
  PERSONAL_VEHICLE,
  previewDeparture,
  reassignOnDeparture,
  resolveSuccessor,
  rideAfterDeparture,
} from "./departure.js";

/*
  STI-306. Two halves:

  The pure half needs no database — the ownership literal and the truck/trailer
  rule are decisions, not queries, and the ownership literal in particular is
  the one this ticket was emphatic about: the plan's pseudocode compares
  against 'personal', which is not a value the column can hold, and that
  mismatch does not throw. It silently reassigns somebody's own truck.

  The rest is integration, for the same reason custody.test.ts is: the
  behaviour under test IS the transaction. A mocked "one transaction" proves
  that a mock rolls back. Runs against the real Postgres named by DATABASE_URL
  — always set inside the api container, where `make ENV=local test` runs — and
  skipped without it so a host-side `pnpm test` still passes.
*/

describe("the ownership values are the ones the column actually holds (STI-306)", () => {
  it("skips on `personal_allowance`, the value in the schema — not the plan's `personal`", () => {
    expect(PERSONAL_VEHICLE).toBe("personal_allowance");
    expect(VEHICLE_OWNERSHIP).toContain(PERSONAL_VEHICLE);
    /* The pseudocode's pair. Neither string exists, and comparing against them
       is a silent no-op rather than an error — every personal truck would fall
       through into the moving set. */
    expect(VEHICLE_OWNERSHIP as readonly string[]).not.toContain("personal");
    expect(VEHICLE_OWNERSHIP as readonly string[]).not.toContain("company");
  });
});

describe("what a tool rides in after its holder leaves (STI-306 / STI-203)", () => {
  const leaving = new Set(["personal-truck-id"]);

  it("carries a company rig forward verbatim — the tools never left the trailer", () => {
    expect(rideAfterDeparture({ truckId: "company-truck-id", trailerId: "trailer-id" }, leaving)).toEqual({
      truckId: "company-truck-id",
      trailerId: "trailer-id",
    });
  });

  it("writes an explicit null for a vehicle that drives away with the leaver", () => {
    const out = rideAfterDeparture({ truckId: "personal-truck-id", trailerId: "trailer-id" }, leaving);
    expect(out.truckId).toBeNull();
    expect(out.trailerId).toBe("trailer-id");
  });

  it("leaves an absent key absent — absent is 'not recorded', null is 'affirmatively none'", () => {
    const out = rideAfterDeparture({}, leaving);
    expect("truckId" in out).toBe(false);
    expect("trailerId" in out).toBe(false);
  });

  it("keeps an explicit null explicit", () => {
    const out = rideAfterDeparture({ truckId: null }, leaving);
    expect("truckId" in out).toBe(true);
    expect(out.truckId).toBeNull();
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("a departure moves everything at once, or nothing (STI-306)", () => {
  let db: Database;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let leaverId: string;
  let successorId: string;
  let companyTruckId: string;
  let companyTruckLocationId: string;
  let personalTruckId: string;
  let personalTruckLocationId: string;
  let gangBoxId: string;
  let foreignTruckId: string;

  async function newEmployee(
    name: string,
    opts: { status?: string; reportsTo?: string | null; role?: string; tid?: string } = {},
  ): Promise<string> {
    const [row] = await db
      .insert(schema.employee)
      .values({
        tenantId: opts.tid ?? tenantId,
        name,
        role: opts.role ?? "foreman",
        employmentStatus: opts.status ?? "active",
        reportsToEmployeeId: opts.reportsTo ?? null,
      })
      .returning({ id: schema.employee.id });
    return row!.id;
  }

  /*
    A tool on somebody's name — projection AND custody link, the way the rest
    of the system produces one.

    This used to insert the `asset` row alone, with `currentCustodianId` set
    and no `assignment` at all. Every fixture tool therefore started with ZERO
    active links, which made the headline assertion of this file vacuous:
    `expect(links).toHaveLength(1)` passed for any implementation that merely
    OPENS a link, including one that never closes the previous holder's. The
    bug the chokepoint exists to prevent — two custodians for one tool — was
    the one thing these tests could not see. So the link is opened through
    `moveCustody`, exactly as `assignment.approve` opens one, and the tests
    below assert the PRIOR link is closed as well as a new one opened.
  */
  async function newHeldAsset(
    custodianId: string,
    description: string,
    opts: {
      status?: string;
      locationId?: string | null;
      ride?: { truckId?: string | null; trailerId?: string | null };
    } = {},
  ): Promise<string> {
    const locationId = opts.locationId ?? null;
    const [row] = await db
      .insert(schema.asset)
      .values({
        tenantId,
        description,
        currentStatus: opts.status ?? "assigned",
        currentCustodianId: custodianId,
        currentLocationId: locationId,
      })
      .returning({ id: schema.asset.id });
    const assetId = row!.id;

    await db.transaction(async (tx) => {
      await moveCustody(tx, {
        tenantId,
        assetId,
        toCustodianId: custodianId,
        projectId: null,
        locationId,
        truckId: opts.ride?.truckId,
        trailerId: opts.ride?.trailerId,
        actorUserId: userId,
      });
    });

    /* The ledger snapshot the vehicle keys are read back from — the asset table
       has no truck columns, so this is their only record. */
    await db.insert(schema.transaction).values({
      tenantId,
      assetId,
      eventType: "assign",
      toState: {
        status: opts.status ?? "assigned",
        custodianId,
        projectId: null,
        locationId,
        ...(opts.ride ?? {}),
      },
      note: "STI-306 fixture",
    });
    return assetId;
  }

  /** A tool nobody holds, sitting in a container. No custodian, no link. */
  async function newLooseAsset(locationId: string, description: string): Promise<string> {
    const [row] = await db
      .insert(schema.asset)
      .values({ tenantId, description, currentStatus: "available", currentLocationId: locationId })
      .returning({ id: schema.asset.id });
    return row!.id;
  }

  /* A vehicle is 1:1 with a vehicle-type location row; the location carries the
     authoritative custodian and the vehicle mirrors it. */
  async function newVehicle(opts: {
    unit: string;
    vehicleType: "truck" | "trailer";
    ownershipType?: string;
    custodianId?: string | null;
    tid?: string;
  }): Promise<{ vehicleId: string; locationId: string }> {
    const tid = opts.tid ?? tenantId;
    const [loc] = await db
      .insert(schema.location)
      .values({ tenantId: tid, type: "vehicle", name: opts.unit, custodianEmployeeId: opts.custodianId ?? null })
      .returning({ id: schema.location.id });
    const [v] = await db
      .insert(schema.vehicle)
      .values({
        tenantId: tid,
        locationId: loc!.id,
        vehicleType: opts.vehicleType,
        unit: opts.unit,
        ...(opts.ownershipType ? { ownershipType: opts.ownershipType } : {}),
        foremanEmployeeId: opts.custodianId ?? null,
      })
      .returning({ id: schema.vehicle.id });
    return { vehicleId: v!.id, locationId: loc!.id };
  }

  /** A LATER snapshot than the fixture's, to override the recorded ride. */
  async function recordRide(assetId: string, ride: Record<string, unknown>) {
    await db.insert(schema.transaction).values({
      tenantId,
      assetId,
      eventType: "assign",
      toState: { status: "assigned", custodianId: leaverId, projectId: null, locationId: null, ...ride },
      note: "STI-306 fixture",
    });
  }

  /* Every link on the tool, closed ones included — the closed rows are half of
     what makes the one-active-link invariant meaningful. */
  const linksFor = (assetId: string) =>
    db
      .select({
        id: schema.assignment.id,
        status: schema.assignment.status,
        custodianId: schema.assignment.custodianId,
        truckId: schema.assignment.truckId,
        locationId: schema.assignment.locationId,
      })
      .from(schema.assignment)
      .where(and(eq(schema.assignment.tenantId, tenantId), eq(schema.assignment.assetId, assetId)));

  const activeLink = async (assetId: string) => (await linksFor(assetId)).filter((l) => l.status === "active");

  const custodianOf = async (assetId: string) =>
    (
      await db
        .select({ c: schema.asset.currentCustodianId })
        .from(schema.asset)
        .where(eq(schema.asset.id, assetId))
    )[0]?.c ?? null;

  const lastEvent = async (assetId: string) =>
    (
      await db
        .select({ eventType: schema.transaction.eventType, toState: schema.transaction.toState, note: schema.transaction.note })
        .from(schema.transaction)
        .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)))
        .orderBy(sql`${schema.transaction.occurredAt} DESC, ${schema.transaction.id} DESC`)
        .limit(1)
    )[0];

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-306 departure test", slug: `sti306-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [t2] = await db
      .insert(schema.tenant)
      .values({ name: "STI-306 other tenant", slug: `sti306b-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    otherTenantId = t2!.id;
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: "sti306@test.local", passwordHash: "not-a-real-hash", firstName: "STI", lastName: "ThreeOhSix" })
      .returning({ id: schema.user.id });
    userId = u!.id;

    successorId = await newEmployee("Superintendent Reyes", { role: "superintendent" });
    leaverId = await newEmployee("Departing Foreman", { status: "terminated", reportsTo: successorId });

    const company = await newVehicle({ unit: "T-306", vehicleType: "truck", custodianId: leaverId });
    companyTruckId = company.vehicleId;
    companyTruckLocationId = company.locationId;

    const personal = await newVehicle({
      unit: "P-306",
      vehicleType: "truck",
      ownershipType: PERSONAL_VEHICLE,
      custodianId: leaverId,
    });
    personalTruckId = personal.vehicleId;
    personalTruckLocationId = personal.locationId;

    /* A gang box has no vehicle row at all — there is no such thing as a
       personal one, so it must move like any other container. */
    const [box] = await db
      .insert(schema.location)
      .values({ tenantId, type: "gang_box", name: "GB-306", custodianEmployeeId: leaverId })
      .returning({ id: schema.location.id });
    gangBoxId = box!.id;

    foreignTruckId = (await newVehicle({ unit: "T-FOREIGN-306", vehicleType: "truck", tid: otherTenantId })).vehicleId;
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* Ledger rows are written here, so the cascade delete needs the
         sanctioned transactional trigger disable (migration 0014). */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, otherTenantId));
        await tx.execute(sql`ALTER TABLE "transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("skips the personal truck, moves the company truck and the gang box", async () => {
    /* Recorded riding — and SITTING IN — the truck the leaver keeps. Both
       halves have to be answered, not just the truck key. */
    const rides = await newHeldAsset(leaverId, "STI-306 hammer drill riding the personal truck", {
      locationId: personalTruckLocationId,
      ride: { truckId: personalTruckId },
    });
    const inBox = await newHeldAsset(leaverId, "STI-306 grinder in the gang box", { locationId: gangBoxId });
    /* A LOST tool on the leaver's name. `dashboard.clearanceQueue` counts it
       (`current_status != 'available'` is its whole predicate), so a preview
       that omitted it told the operator there was nothing to move while the
       clearance card kept showing one — and that queue entry could then never
       be cleared. */
    const lost = await newHeldAsset(leaverId, "STI-306 laser level, last seen on the job", { status: "lost" });
    /* Nobody's tool, sitting in the leaver's gang box. It has no custodian, so
       the tools loop cannot see it: the only thing that moves it is the
       sanctioned container writer moving the box's CONTENTS. If this stays
       `available` on nobody's name, the departure went round that writer. */
    const looseInBox = await newLooseAsset(gangBoxId, "STI-306 spare breaker bar in the gang box");

    const preview = await previewDeparture(db, { tenantId, leaverEmployeeId: leaverId });
    expect(preview.successor?.id).toBe(successorId);
    expect(preview.tools.map((t) => t.assetId).sort()).toEqual([rides, inBox, lost].sort());

    /* The preview and the queue it is opened from must answer the same
       question. Run the queue's own predicate and compare the counts. */
    const [queueCount] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.asset)
      .where(
        sql`${schema.asset.tenantId} = ${tenantId} AND ${schema.asset.currentStatus} != 'available' AND ${schema.asset.currentCustodianId} = ${leaverId}`,
      );
    expect(preview.tools).toHaveLength(queueCount!.c);
    /* The operator must be told WHY the truck is not in the list, on the
       screen — not by reading the source. */
    expect(preview.skipped).toHaveLength(1);
    expect(preview.skipped[0]!.unit).toBe("P-306");
    expect(preview.skipped[0]!.reason).toMatch(/personal/i);
    expect(preview.containers.map((c) => c.locationId).sort()).toEqual(
      [companyTruckLocationId, gangBoxId].sort(),
    );

    /* The links as they stand BEFORE the move, so the assertions below can name
       the exact rows that must end up closed. */
    const priorLinkIds = new Map<string, string>();
    for (const assetId of [rides, inBox, lost]) {
      const links = await linksFor(assetId);
      expect(links).toHaveLength(1);
      expect(links[0]!.status).toBe("active");
      expect(links[0]!.custodianId).toBe(leaverId);
      priorLinkIds.set(assetId, links[0]!.id);
    }

    const result = await reassignOnDeparture(db, {
      tenantId,
      leaverEmployeeId: leaverId,
      actorUserId: userId,
    });
    expect(result.tools).toHaveLength(3);

    /* The personal truck is not Urban property: it stays on the leaver's name
       and drives off site with them. */
    const [personalLoc] = await db
      .select({ custodianEmployeeId: schema.location.custodianEmployeeId })
      .from(schema.location)
      .where(eq(schema.location.id, personalTruckLocationId));
    expect(personalLoc!.custodianEmployeeId).toBe(leaverId);
    const [personalVeh] = await db
      .select({ foremanEmployeeId: schema.vehicle.foremanEmployeeId })
      .from(schema.vehicle)
      .where(eq(schema.vehicle.id, personalTruckId));
    expect(personalVeh!.foremanEmployeeId).toBe(leaverId);

    // The company truck and the gang box did move, mirror column included.
    for (const locId of [companyTruckLocationId, gangBoxId]) {
      const [loc] = await db
        .select({ custodianEmployeeId: schema.location.custodianEmployeeId })
        .from(schema.location)
        .where(eq(schema.location.id, locId));
      expect(loc!.custodianEmployeeId).toBe(successorId);
    }
    const [companyVeh] = await db
      .select({ foremanEmployeeId: schema.vehicle.foremanEmployeeId })
      .from(schema.vehicle)
      .where(eq(schema.vehicle.id, companyTruckId));
    expect(companyVeh!.foremanEmployeeId).toBe(successorId);

    /* The gang box's contents came with it, through `applyContainerCustody` —
       the one writer that knows a container hand-over moves what is inside.
       A departure that set the custodian columns itself leaves this tool
       `available` on nobody's name. */
    expect(result.containerToolsMoved).toBeGreaterThanOrEqual(1);
    expect(await custodianOf(looseInBox)).toBe(successorId);

    /*
      Custody went through the chokepoint. BOTH halves, because only the second
      one has any teeth: an implementation that opens a link and never closes
      the old one also leaves exactly one link per tool if the tool started
      with none — which is what these fixtures used to do, and why this
      assertion was previously vacuous.
    */
    for (const assetId of [rides, inBox, lost]) {
      expect(await custodianOf(assetId)).toBe(successorId);
      const links = await linksFor(assetId);
      expect(links).toHaveLength(2);
      const prior = links.find((l) => l.id === priorLinkIds.get(assetId))!;
      expect(prior.status).toBe("transferred");
      expect(prior.custodianId).toBe(leaverId);
      const active = links.filter((l) => l.status === "active");
      expect(active).toHaveLength(1);
      expect(active[0]!.custodianId).toBe(successorId);
    }

    /* The tool that was riding the truck the leaver keeps is affirmatively out
       of it — an absent key would read "not recorded" and a stale uuid would
       point at a vehicle Urban no longer has. */
    expect((await activeLink(rides))[0]!.truckId).toBeNull();
    /* And it is not still recorded as sitting INSIDE that truck. The location
       row stays on the leaver, so a tool pointing at it would name a place
       Urban cannot open — on the same snapshot that has just said "no truck".
       Null is "we do not know where it is", which is the truth and is also the
       prompt the desk needs. Projection and snapshot are written together, so
       they must agree — a mismatch here is a `stale_projection` divergence
       every six hours forever. */
    expect((await activeLink(rides))[0]!.locationId).toBeNull();
    const [ridesRow] = await db
      .select({ loc: schema.asset.currentLocationId })
      .from(schema.asset)
      .where(eq(schema.asset.id, rides));
    expect(ridesRow!.loc).toBeNull();

    const ev = await lastEvent(rides);
    expect(ev!.eventType).toBe("custodian_change");
    expect(ev!.note).toMatch(/Departure: Departing Foreman/);
    const to = ev!.toState as Record<string, unknown>;
    /* A COMPLETE snapshot: the fold replaces, so a missing base key here blanks
       custodian, project or location on the next rebuild. */
    expect(Object.keys(to).sort()).toEqual(["custodianId", "locationId", "projectId", "status", "truckId"].sort());
    expect(to.custodianId).toBe(successorId);
    expect(to.status).toBe("assigned");
    expect(to.truckId).toBeNull();
    expect(to.locationId).toBeNull();

    /* The tool in the gang box did NOT lose its place — only a container that
       drives away with the person can do that. */
    const inBoxEvent = await lastEvent(inBox);
    expect((inBoxEvent!.toState as Record<string, unknown>).locationId).toBe(gangBoxId);

    /* A lost tool moves like everything else, and keeps its status: a departure
       moves the WHO, and asserting `assigned` here would quietly un-lose it. */
    const lostEvent = await lastEvent(lost);
    expect((lostEvent!.toState as Record<string, unknown>).status).toBe("lost");
  });

  it("refuses a leaver who has not actually left, and names the status it found", async () => {
    /* The form only offers terminated people; a filter in a <select> is not a
       rule. Without this check the procedure strips an ACTIVE foreman's tools
       in one irreversible transaction and writes ledger events naming a
       departure that never happened. */
    const stillHere = await newEmployee("Still Employed Foreman", { reportsTo: successorId });
    const assetId = await newHeldAsset(stillHere, "STI-306 tool of somebody who has not left");

    await expect(previewDeparture(db, { tenantId, leaverEmployeeId: stillHere })).rejects.toThrow(/"active"/);
    await expect(
      reassignOnDeparture(db, { tenantId, leaverEmployeeId: stillHere, actorUserId: userId }),
    ).rejects.toThrow(/still on the books/);

    expect(await custodianOf(assetId)).toBe(stillHere);
    const links = await activeLink(assetId);
    expect(links).toHaveLength(1);
    expect(links[0]!.custodianId).toBe(stillHere);

    /* On leave is not gone either — they are coming back to the tools, and the
       clearance queue only ever lists `terminated`. */
    const onLeave = await newEmployee("Foreman On Leave", { status: "on_leave", reportsTo: successorId });
    await expect(
      reassignOnDeparture(db, { tenantId, leaverEmployeeId: onLeave, actorUserId: userId }),
    ).rejects.toThrow(/on_leave/);
  });

  it("raises rather than guessing when the reporting chain yields nobody", async () => {
    const orphan = await newEmployee("Orphaned Foreman", { status: "terminated" });
    const assetId = await newHeldAsset(orphan, "STI-306 saw with no successor in sight");

    const preview = await previewDeparture(db, { tenantId, leaverEmployeeId: orphan });
    expect(preview.successor).toBeNull();
    expect(preview.successorRequired).toBe(true);

    await expect(
      reassignOnDeparture(db, { tenantId, leaverEmployeeId: orphan, actorUserId: userId }),
    ).rejects.toThrow(/Choose who takes their tools/);

    /* Never silently left with the leaver, and never quietly parked on
       somebody the code picked. The tool still has its ORIGINAL active link —
       nothing was closed either, which is the half a "no rows" assertion
       cannot tell you. */
    expect(await custodianOf(assetId)).toBe(orphan);
    const links = await linksFor(assetId);
    expect(links).toHaveLength(1);
    expect(links[0]!.status).toBe("active");
    expect(links[0]!.custodianId).toBe(orphan);
  });

  it("steps over a terminated superintendent and lands on the Project Manager", async () => {
    const pm = await newEmployee("Project Manager Ortiz", { role: "pm" });
    const goneSuper = await newEmployee("Departed Superintendent", { status: "terminated", reportsTo: pm, role: "superintendent" });
    const foreman = await newEmployee("Second Foreman", { status: "terminated", reportsTo: goneSuper });

    const successor = await resolveSuccessor(db, tenantId, {
      id: foreman,
      name: "Second Foreman",
      reportsToEmployeeId: goneSuper,
    });
    expect(successor?.id).toBe(pm);
    expect(successor?.source).toBe("reports_to");
  });

  it("moves nothing at all when one item fails", async () => {
    const solo = await newEmployee("Third Foreman", { status: "terminated", reportsTo: successorId });
    const a = await newHeldAsset(solo, "STI-306 all-or-nothing A");
    const b = await newHeldAsset(solo, "STI-306 all-or-nothing B");
    const c = await newHeldAsset(solo, "STI-306 all-or-nothing C");

    /* The move takes its rows in id order, so poisoning the LAST one proves
       the tools already moved ahead of it are rolled back — not merely that
       the first row failed before anything happened. The poison is a ride
       naming another tenant's truck: `assertVehicleContext` inside the
       chokepoint refuses it, which is the same guard a real corrupt snapshot
       would hit. */
    const poisoned = [a, b, c].sort().at(-1)!;
    await recordRide(poisoned, { truckId: foreignTruckId });

    await expect(
      reassignOnDeparture(db, { tenantId, leaverEmployeeId: solo, actorUserId: userId }),
    ).rejects.toThrow();

    /* Rolled all the way back: still on the leaver, and still on the SAME
       active link. A close without a matching open would show up here as a
       tool with no active link at all. */
    for (const assetId of [a, b, c]) {
      expect(await custodianOf(assetId)).toBe(solo);
      const links = await linksFor(assetId);
      expect(links).toHaveLength(1);
      expect(links[0]!.status).toBe("active");
      expect(links[0]!.custodianId).toBe(solo);
    }
    /* And no half-written ledger: a departure that appended events for two of
       three tools cannot be undone, because the ledger is append-only. */
    const events = await db
      .select({ id: schema.transaction.id })
      .from(schema.transaction)
      .where(
        and(
          eq(schema.transaction.tenantId, tenantId),
          inArray(schema.transaction.assetId, [a, b, c]),
          eq(schema.transaction.eventType, "custodian_change"),
        ),
      );
    expect(events).toHaveLength(0);
  });
});
