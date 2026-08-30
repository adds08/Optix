import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { featureRouter } from "./routers/feature.js";
import { assetRouter } from "./routers/asset.js";
import type { Context } from "./trpc.js";

/*
  ADR-13 (docs/06-decisions.md) — feature presentation is four states, and
  every one of them is presentation ONLY. `tenant_feature` deciding a nav row
  is hidden must have zero effect on what a server procedure allows; if it
  ever did, hiding would have quietly become a second, weaker access control
  living beside the real one, which is the exact failure ADR-11 (the binary
  predecessor this generalizes) was written to rule out.

  This is the STI-1204 acceptance criterion made concrete: "the API still
  enforces every permission behind [a hidden module], proven by a test that
  calls a disabled module's procedure and gets its normal answer." `asset.list`
  is the stand-in for "a disabled module's procedure" — nothing about it reads
  `tenant_feature`, so the proof is that setting the corresponding key to
  `hidden` changes nothing about what it returns.
*/

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("feature visibility is presentation, not authorisation (ADR-13)", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;

  const ctx = (): Context => ({
    db,
    session: {
      userId,
      tenantId,
      employeeId: null,
      permissions: new Set<Permission>(["asset.read", "asset.manage", "config.manage", "assets.view.all"]),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "adr13-test-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "ADR-13 feature visibility", slug: `adr13-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: `adr13-${crypto.randomUUID().slice(0, 8)}@test.local`, passwordHash: "not-a-real-hash", firstName: "ADR", lastName: "Thirteen" })
      .returning({ id: schema.user.id });
    userId = u!.id;
    await db.insert(schema.asset).values({
      tenantId,
      tag: "ADR13-A",
      description: "ADR-13 canary asset",
      currentStatus: "available",
    });
  });

  afterAll(async () => {
    if (db && tenantId) {
      await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
    }
    await db?.$client.end();
  });

  it("hiding the tool-register nav key does not change what asset.list returns", async () => {
    const before = await assetRouter.createCaller(ctx()).list();
    expect(before.some((a) => a.tag === "ADR13-A")).toBe(true);

    await featureRouter.createCaller(ctx()).set({ key: "tool-register", state: "hidden" });

    const after = await assetRouter.createCaller(ctx()).list();
    expect(after.some((a) => a.tag === "ADR13-A")).toBe(true);
    expect(after.length).toBe(before.length);
  });

  it("feature.states reports the state back, unopinionated about what it means", async () => {
    await featureRouter.createCaller(ctx()).set({ key: "some-module", state: "upcoming" });
    const states = await featureRouter.createCaller(ctx()).states();
    expect(states["some-module"]).toBe("upcoming");
    /* A key nobody has ever set is absent, not "hidden" or any other default
       baked into the read path — the caller (nav-config.ts's
       applyFeatureStates) is what decides an absent key means "enabled". */
    expect(states["never-set-key"]).toBeUndefined();
  });

  it("set is idempotent-by-key: setting the same key twice updates the one row rather than duplicating it", async () => {
    await featureRouter.createCaller(ctx()).set({ key: "toggle-me", state: "beta" });
    await featureRouter.createCaller(ctx()).set({ key: "toggle-me", state: "hidden" });
    const rows = await db
      .select()
      .from(schema.tenantFeature)
      .where(eq(schema.tenantFeature.tenantId, tenantId));
    const matching = rows.filter((r) => r.key === "toggle-me");
    expect(matching.length).toBe(1);
    expect(matching[0]!.state).toBe("hidden");
  });
});
