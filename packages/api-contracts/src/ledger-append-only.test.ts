import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";

/*
  Integration tests for STI-104: the `transaction` ledger is append-only,
  enforced by database triggers (packages/db/drizzle/0014_append_only_ledger.sql),
  not by application discipline. Without these, the suite passes identically
  whether the triggers exist or not — so a re-generate, a `push-dangerous` or a
  careless migration could drop them and nothing would notice.

  Like custody.test.ts these run against the real Postgres named by
  DATABASE_URL (always set inside the api container, where `make ENV=local
  test` runs) and skip without it. If a trigger is missing, the UPDATE/DELETE
  statements succeed and every test here fails — that is the point.

  The cascade case is the one that matters most: `asset.id -> transaction.asset_id`
  is `on delete cascade`, and a cascade DELETE fires the row trigger too. That
  cascade is why `asset.delete` (routers/asset.ts) no longer attempts hard
  deletes — QA had to find the bypass-that-isn't by hand once; this pins it.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("ledger is append-only at the database (STI-104)", () => {
  let db: Database;
  let tenantId: string;
  let assetId: string;
  let eventId: number;

  /* Rejection must be the trigger's, classifiable on SQLSTATE 0A000 — never
     matched on message text. drizzle may surface the postgres.js error direct
     or as `cause`, so accept either. */
  async function expectAppendOnlyBlock(p: Promise<unknown>) {
    let err: unknown;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    expect(err, "statement was not blocked — are the 0014 append-only triggers missing?").toBeDefined();
    const code = (err as { code?: string }).code ?? ((err as { cause?: { code?: string } }).cause?.code);
    expect(code).toBe("0A000");
  }

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-104 append-only test", slug: `sti104-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [a] = await db
      .insert(schema.asset)
      .values({ tenantId, description: "STI-104 rotary hammer" })
      .returning({ id: schema.asset.id });
    assetId = a!.id;
    /* INSERT must remain allowed — the app keeps appending. This write doubles
       as that assertion: if it throws, the trigger overreaches. */
    const [e] = await db
      .insert(schema.transaction)
      .values({
        tenantId,
        assetId,
        eventType: "tag",
        toState: { status: "available", custodianId: null, projectId: null, locationId: null },
        note: "STI-104 test event",
      })
      .returning({ id: schema.transaction.id });
    eventId = e!.id;
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* This tenant owns ledger rows, so the cascade delete custody.test.ts
         uses would itself be blocked. Use the one sanctioned mechanism — the
         same transactional disable/enable the seed's SEED_RESET wipe uses —
         so a shared dev database stays clean and the guard cannot be left off
         by an aborted cleanup. */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("blocks UPDATE with SQLSTATE 0A000", async () => {
    await expectAppendOnlyBlock(
      db.update(schema.transaction).set({ note: "rewritten" }).where(eq(schema.transaction.id, eventId)),
    );
  });

  it("blocks DELETE with SQLSTATE 0A000", async () => {
    await expectAppendOnlyBlock(db.delete(schema.transaction).where(eq(schema.transaction.id, eventId)));
  });

  it("blocks the asset-delete cascade — the ledger cannot be emptied through its parent", async () => {
    await expectAppendOnlyBlock(db.delete(schema.asset).where(eq(schema.asset.id, assetId)));
    /* The blocked cascade must abort the whole statement: the asset row
       survives, custody history intact. */
    const survivors = await db
      .select({ id: schema.asset.id })
      .from(schema.asset)
      .where(eq(schema.asset.id, assetId));
    expect(survivors).toHaveLength(1);
  });
});
