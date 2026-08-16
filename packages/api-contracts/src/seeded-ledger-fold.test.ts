import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import { reconcileProjections, type EventEnvelope } from "@stinventory/domain";

/*
  Regression gate for STI-108: the ledger the seed writes must fold to the
  projection the seed also writes.

  The seed used to write `toState: null` on every event while setting
  `asset.current_*` directly, so `foldAssetState` was a no-op on every seeded
  asset: `asset.rebuild` reported nothing rebuilt and the boot sweep raised one
  `custody_discrepancy` per asset (~754) on every fresh reset. Migration 0013
  repaired one database and its NOT EXISTS guard never re-runs — after STI-101
  closed the incident, nothing failed when the seed regressed, which is exactly
  how the bug came back. This test is the missing gate: revert seed.ts to
  `toState: null` (or to a partial snapshot — the fold replaces, it does not
  merge) and it goes red.

  Like custody.test.ts and ledger-append-only.test.ts this runs against the
  real Postgres named by DATABASE_URL — always set inside the api container,
  where `make ENV=local test` runs against the seeded database — and skips
  without it so CI's database-less check job still passes. It is scoped to the
  seeded `urban` tenant so the throwaway tenants the neighbouring integration
  tests create and delete mid-run can never make it flake, and it skips when
  that tenant is absent (an unseeded database has nothing to gate). Read-only:
  it writes nothing and leaves the database exactly as found.

  The invariant is stable under correct runtime mutation, not a brittle
  seeded-data snapshot: every runtime writer appends a complete `toState`
  alongside its projection update, so approvals and transfers made through the
  app keep the fold and the register in agreement (QA verified 0 divergences
  after live approvals). Only a writer that breaks the ledger contract — the
  seed included — can turn this red.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("seeded ledger folds to the seeded projection (STI-108)", () => {
  let db: Database;

  beforeAll(() => {
    db = createDb(url!);
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  it("every asset with ledger events folds to its asset.current_*", async (ctx) => {
    const tenant = await db.query.tenant.findFirst({
      where: eq(schema.tenant.slug, "urban"),
    });
    if (!tenant) return ctx.skip();

    const projected = await db
      .select({
        assetId: schema.asset.id,
        label: schema.asset.tag,
        status: schema.asset.currentStatus,
        custodianId: schema.asset.currentCustodianId,
        projectId: schema.asset.currentProjectId,
        locationId: schema.asset.currentLocationId,
      })
      .from(schema.asset)
      .where(eq(schema.asset.tenantId, tenant.id));
    /* Same cast tenantLedger (routers/asset.ts) uses: the one place the jsonb
       `unknown` is pinned to the snapshot shape the domain fold consumes. */
    const events = (await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.tenantId, tenant.id))) as unknown as EventEnvelope[];

    /* Only assets whose ledger carries events are in scope — an asset with an
       empty ledger has nothing to fold. For those in scope an event without a
       complete snapshot is NOT a pass: reconcileProjections treats an empty
       fold as a divergence, which is precisely what catches `toState: null`. */
    const withEvents = new Set(events.map((e) => e.assetId));
    const inScope = projected.filter((p) => withEvents.has(p.assetId));

    /* A vacuous green is no gate: the seeded tenant carries one event per
       asset, so an empty in-scope set means the ledger was not seeded at all. */
    expect(inScope.length).toBeGreaterThan(0);

    const divergences = reconcileProjections(inScope, events);
    /* Two assertions so a failure names the first offenders instead of only
       printing a count. */
    expect(divergences.slice(0, 3)).toEqual([]);
    expect(divergences).toHaveLength(0);
  });
});
