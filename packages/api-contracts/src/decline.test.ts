import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { moveCustody } from "./custody.js";
import { assignmentRouter } from "./routers/assignment.js";
import { transferRouter } from "./routers/transfer.js";
import type { Context } from "./trpc.js";

/*
  STI-112: the decline paths. Two defects, both QA-found: the assignment
  CONFLICT message rendered "This assignment is already ." (the status
  interpolation was missing — which is why criterion 1 says verify by
  RENDERING it, not reading the diff), and the two decline procedures treated
  the ledger differently — transfer.decline wrote a from=to event while
  assignment.decline wrote nothing.

  The decision, recorded on assignment.decline's ledger insert: a decline IS
  custody-affecting, so both procedures now write a from_state = to_state
  event carrying the complete four-key snapshot. Custody itself must remain
  genuinely unchanged — that is asserted against the database, not inspected.

  Same harness rules as custody.test.ts: real Postgres via DATABASE_URL
  (skipped without it), a throwaway tenant, trigger-disabled cleanup because
  ledger rows are written.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("decline paths: real message, agreed ledger behaviour (STI-112)", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;
  let empA: string;
  let empB: string;
  let projectId: string;
  let locationId: string;
  let ctx: Context;

  /* An asset in empA's custody with a project and a location — a decline must
     leave every bit of this exactly as it found it. */
  async function assignedAsset(): Promise<string> {
    const [row] = await db
      .insert(schema.asset)
      .values({
        tenantId,
        description: "STI-112 demo grinder",
        currentStatus: "assigned",
        currentCustodianId: empA,
        currentProjectId: projectId,
        currentLocationId: locationId,
      })
      .returning({ id: schema.asset.id });
    await db.transaction((tx) =>
      moveCustody(tx, { tenantId, assetId: row!.id, toCustodianId: empA, projectId, locationId, actorUserId: userId }),
    );
    return row!.id;
  }

  const assignedState = () => ({
    status: "assigned",
    custodianId: empA,
    projectId,
    locationId,
  });

  const eventsFor = (refType: "assignment" | "transfer", refId: string) =>
    db
      .select()
      .from(schema.transaction)
      .where(
        and(
          eq(schema.transaction.tenantId, tenantId),
          eq(schema.transaction.refType, refType),
          eq(schema.transaction.refId, refId),
        ),
      );

  async function expectCustodyUnchanged(assetId: string) {
    const asset = await db.query.asset.findFirst({ where: and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tenantId)) });
    expect(asset?.currentStatus).toBe("assigned");
    expect(asset?.currentCustodianId).toBe(empA);
    expect(asset?.currentProjectId).toBe(projectId);
    expect(asset?.currentLocationId).toBe(locationId);
    const active = await db
      .select({ custodianId: schema.assignment.custodianId })
      .from(schema.assignment)
      .where(
        and(
          eq(schema.assignment.tenantId, tenantId),
          eq(schema.assignment.assetId, assetId),
          eq(schema.assignment.status, "active"),
        ),
      );
    expect(active).toHaveLength(1);
    expect(active[0]!.custodianId).toBe(empA);
  }

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-112 decline test", slug: `sti112-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: "sti112@test.local", passwordHash: "not-a-real-hash", firstName: "STI", lastName: "OneTwelve" })
      .returning({ id: schema.user.id });
    userId = u!.id;
    const [a] = await db.insert(schema.employee).values({ tenantId, name: "Foreman A" }).returning({ id: schema.employee.id });
    const [b] = await db.insert(schema.employee).values({ tenantId, name: "Foreman B" }).returning({ id: schema.employee.id });
    empA = a!.id;
    empB = b!.id;
    const [p] = await db.insert(schema.project).values({ tenantId, name: "STI-112 substation" }).returning({ id: schema.project.id });
    projectId = p!.id;
    const [l] = await db
      .insert(schema.location)
      .values({ tenantId, type: "warehouse", name: "STI-112 yard" })
      .returning({ id: schema.location.id });
    locationId = l!.id;

    ctx = {
      db,
      session: {
        userId,
        tenantId,
        employeeId: null,
        permissions: new Set<Permission>(["assignment.approve", "transfer.approve"]),
        roleName: null,
        actorLabel: null,
      },
      sessionSecret: "sti112-test-secret",
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    };
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* Ledger rows were written, so the cascade delete needs the sanctioned
         transactional trigger disable (see 0014, and the STI-113 test). */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("the CONFLICT message names the actual status (defect 1) — rendered, not read", async () => {
    const assetId = await assignedAsset();
    const active = await db.query.assignment.findFirst({
      where: and(eq(schema.assignment.assetId, assetId), eq(schema.assignment.status, "active")),
    });
    /* The broken interpolation rendered "This assignment is already ." — an
       exact-string match on the rendered message is the only thing that can
       tell the two apart. */
    await expect(assignmentRouter.createCaller(ctx).decline({ id: active!.id })).rejects.toThrow(
      "This assignment is already active.",
    );

    const [doneTransfer] = await db
      .insert(schema.transfer)
      .values({ tenantId, assetId, toCustodianId: empB, status: "completed", requestedBy: userId })
      .returning({ id: schema.transfer.id });
    await expect(transferRouter.createCaller(ctx).decline({ id: doneTransfer!.id })).rejects.toThrow(
      "This transfer is already completed.",
    );
  });

  it("assignment.decline writes a complete from=to ledger event and moves nothing (defect 2)", async () => {
    const assetId = await assignedAsset();
    /* A proposal to hand the tool to empB, fabricated directly: a pending row
       is not custody, so it neither goes through the chokepoint nor trips the
       STI-103 active-only unique index. */
    const [pending] = await db
      .insert(schema.assignment)
      .values({
        tenantId,
        assetId,
        custodianId: empB,
        startDate: new Date().toISOString().slice(0, 10),
        status: "pending_approval",
      })
      .returning({ id: schema.assignment.id });

    await assignmentRouter.createCaller(ctx).decline({ id: pending!.id, reason: "budget hold" });

    const row = await db.query.assignment.findFirst({ where: eq(schema.assignment.id, pending!.id) });
    expect(row?.status).toBe("cancelled");

    /* The refusal is in the tool's history — one event, from_state and
       to_state identical and COMPLETE. The fold replaces rather than merges,
       so a partial "nothing changed" snapshot would still blank what it omits
       on the next rebuild (STI-112 criterion 4). */
    const events = await eventsFor("assignment", pending!.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("status_change");
    expect(events[0]!.fromState).toEqual(assignedState());
    expect(events[0]!.toState).toEqual(assignedState());
    expect(events[0]!.note).toBe("Assignment declined — budget hold");

    /* Criterion 5: custody genuinely unchanged, asserted against the rows. */
    await expectCustodyUnchanged(assetId);
  });

  it("transfer.decline writes the same shape of event and moves nothing (criterion 3)", async () => {
    const assetId = await assignedAsset();
    const [pending] = await db
      .insert(schema.transfer)
      .values({ tenantId, assetId, toCustodianId: empB, status: "pending_approval", requestedBy: userId })
      .returning({ id: schema.transfer.id });

    await transferRouter.createCaller(ctx).decline({ id: pending!.id, reason: "wrong yard" });

    const row = await db.query.transfer.findFirst({ where: eq(schema.transfer.id, pending!.id) });
    expect(row?.status).toBe("cancelled");

    const events = await eventsFor("transfer", pending!.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("status_change");
    expect(events[0]!.fromState).toEqual(assignedState());
    expect(events[0]!.toState).toEqual(assignedState());
    expect(events[0]!.note).toBe("Transfer declined — wrong yard");

    await expectCustodyUnchanged(assetId);
  });

  it("two simultaneous declines: one wins, one CONFLICT, one ledger event (STI-109 criterion 5)", async () => {
    /* assignment.decline carried the same pre-lock guard the approve paths
       did; now that declines write ledger events, a lost race here would mint
       duplicates too. Same re-check-under-lock shape, same proof. */
    const caller = assignmentRouter.createCaller(ctx);
    for (let i = 0; i < 5; i++) {
      const assetId = await assignedAsset();
      const [pending] = await db
        .insert(schema.assignment)
        .values({
          tenantId,
          assetId,
          custodianId: empB,
          startDate: new Date().toISOString().slice(0, 10),
          status: "pending_approval",
        })
        .returning({ id: schema.assignment.id });

      const results = await Promise.allSettled([
        caller.decline({ id: pending!.id }),
        caller.decline({ id: pending!.id }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0]!.reason)).toMatch(/already/);

      const events = await eventsFor("assignment", pending!.id);
      expect(events).toHaveLength(1);
    }
  });
});
