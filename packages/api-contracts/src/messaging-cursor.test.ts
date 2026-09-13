import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@optix/db";
import type { Permission } from "@optix/types";
import { messagingRouter } from "./routers/messaging.js";
import type { Context } from "./trpc.js";

/*
  Paginating chat history — the second page.

  `messaging.messages` built its cursor cutoff as a raw subquery reading
  `from "message"`. No table has ever had that name; the physical one is
  `tbl_ops_message`. So every call carrying a cursor raised
  `relation "message" does not exist` and the channel 500'd the moment somebody
  scrolled back.

  It survived because THE FIRST PAGE PASSES NO CURSOR. Opening a channel works,
  a screenshot works, and any test that fetches a channel once works. Only the
  second page is broken, and nothing asked for a second page.

  That is the whole reason this file is separate and small: the bug is not in
  what the procedure returns, it is in the branch a single call never enters.
  So the test fetches a page, takes the id it was given, and asks for the next
  one — the thing a person does by scrolling.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("paginating a channel's messages", () => {
  let db: Database;
  let tenantId: string;
  let otherTenantId: string;
  let channelId: string;
  let otherChannelId: string;
  let userId: string;
  let ctx: Context;

  const ids: string[] = [];

  beforeAll(async () => {
    db = createDb(url!);
    const suffix = crypto.randomUUID().slice(0, 8);

    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "cursor test", slug: `cursor-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;

    const [other] = await db
      .insert(schema.tenant)
      .values({ name: "cursor test other", slug: `cursor-other-${suffix}` })
      .returning({ id: schema.tenant.id });
    otherTenantId = other!.id;

    const [u] = await db
      .insert(schema.user)
      .values({
        tenantId,
        email: `cursor-${suffix}@test.local`,
        passwordHash: "not-a-real-hash",
        firstName: "Cursor",
        lastName: "Reader",
      })
      .returning({ id: schema.user.id });
    userId = u!.id;

    const [c] = await db
      .insert(schema.channel)
      .values({ tenantId, name: "Yard", slug: `yard-${suffix}` })
      .returning({ id: schema.channel.id });
    channelId = c!.id;

    const [oc] = await db
      .insert(schema.channel)
      .values({ tenantId: otherTenantId, name: "Their yard", slug: `their-yard-${suffix}` })
      .returning({ id: schema.channel.id });
    otherChannelId = oc!.id;

    /* Five messages with DISTINCT, DESCENDING timestamps. The cutoff is
       `created_at <`, so rows sharing a timestamp would make the boundary
       ambiguous and the assertion below meaningless. */
    for (let i = 0; i < 5; i++) {
      const [m] = await db
        .insert(schema.message)
        .values({
          tenantId,
          channelId,
          body: `message ${i}`,
          authorUserId: userId,
          createdAt: new Date(Date.UTC(2026, 0, 1, 12, 0, i)),
        })
        .returning({ id: schema.message.id });
      ids.push(m!.id);
    }

    /* One in the other tenant, timestamped LATER than everything above — so if
       the cursor subquery ever stopped scoping by tenant, using it as a cutoff
       would let every message through instead of none. */
    await db.insert(schema.message).values({
      tenantId: otherTenantId,
      channelId: otherChannelId,
      body: "not yours",
      createdAt: new Date(Date.UTC(2026, 0, 1, 23, 0, 0)),
    });

    ctx = {
      db,
      session: {
        userId,
        tenantId,
        employeeId: null,
        /* Empty on purpose: `messaging.messages` is a `protectedProcedure`,
           so a session is all it asks for. Granting permissions it does not
           check would make this fixture lie about what the procedure costs. */
        permissions: new Set<Permission>(),
        roleName: null,
        actorLabel: null,
      },
      sessionSecret: "cursor-test-secret",
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    };
  });

  afterAll(async () => {
    if (db) {
      if (tenantId) await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
      if (otherTenantId) await db.delete(schema.tenant).where(eq(schema.tenant.id, otherTenantId));
    }
    await db?.$client.end();
  });

  it("returns a second page instead of throwing", async () => {
    /* The regression, stated as the user experience: scrolling back in a
       channel raised `relation "message" does not exist`.

       The cursor used is `nextCursor` from the previous page, not an id picked
       out by hand — that is what the UI passes back, so this exercises the
       real round trip rather than a shape only a test would produce. */
    const first = await messagingRouter.createCaller(ctx).messages({ channelId, limit: 2 });
    expect(first.items.length).toBe(2);
    expect(first.nextCursor).toBeTruthy();

    const second = await messagingRouter
      .createCaller(ctx)
      .messages({ channelId, cursor: first.nextCursor!, limit: 2 });

    expect(second.items.length).toBe(2);
    /* Strictly older, and no overlap — a cutoff that silently matched nothing
       would return an empty page and still "not throw". */
    const firstIds = first.items.map((m) => m.id);
    expect(second.items.some((m) => firstIds.includes(m.id))).toBe(false);
  });

  it("walks the whole channel without repeating or skipping a message", async () => {
    /* Newest-first, two at a time, to the end: the five seeded messages come
       back exactly once each. This is what proves the cutoff is `<` and not
       `<=` — an off-by-one would drop a row or repeat one. */
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await messagingRouter.createCaller(ctx).messages({ channelId, cursor, limit: 2 });
      seen.push(...res.items.map((m) => m.id));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }

    expect(seen.length).toBe(5);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it("ignores a cursor belonging to another tenant", async () => {
    /* The subquery resolves the cursor's timestamp, so an unscoped lookup would
       let a foreign uuid set this channel's cutoff. The other tenant's message
       is timestamped later than everything here, so an unscoped cursor would
       return ALL five rows; a scoped one matches nothing and returns none. */
    const [foreign] = await db
      .select({ id: schema.message.id })
      .from(schema.message)
      .where(eq(schema.message.tenantId, otherTenantId));

    const res = await messagingRouter
      .createCaller(ctx)
      .messages({ channelId, cursor: foreign!.id, limit: 10 });

    expect(res.items).toHaveLength(0);
  });
});
