import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { dashboardRouter } from "./routers/dashboard.js";
import { notificationRouter } from "./routers/notification.js";
import type { Context } from "./trpc.js";

/*
  Who a notification belongs to, and what the bell badge counts.

  Reported from production as two sentences — "what even is this?" and "when I
  click on these items nothing happens". Both came out of the same nullable
  column. `user.employee_id` is nullable (seven of the fifteen seeded accounts
  have none, `owner@` among them), and the alerts query narrowed on it like
  this:

      empId ? eq(notification.recipientEmployeeId, empId) : undefined

  Drizzle's `and()` DROPS an `undefined` member rather than reading it as
  "match nothing", so for an employee-less account the recipient predicate
  disappeared and the query returned every unread notification in the tenant.
  The owner was shown repair decisions belonging to a foreman, and clicking
  them did nothing because `notification.markRead` scopes to the recipient and
  correctly refused to touch a row that was not theirs.

  This is the class of bug a type checker cannot see: `undefined` is a legal
  member of `and()`, and the query is valid SQL that silently means something
  much wider than it reads as. Only a test with a second recipient in the
  tenant catches it — one recipient and it passes either way.

  Case 1 fails before the fix (it returns two alerts, not zero). Cases 3 and 4
  pin the badge arithmetic: `unread` used `alerts.length`, which is capped at
  the popover's five, while also summing in `clearance` — the HR offboarding
  gate deleted on 2026-08-27, which the popover already declines to list. On a
  seeded database that was 23 of 30.

  Same harness rules as inbox-dismiss.test.ts: real Postgres via DATABASE_URL
  (skipped without it), a throwaway tenant so the shared seed is untouched.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("a notification belongs to its recipient, and the badge counts it once", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;
  let mine: string;
  let theirs: string;

  /* Two sessions over one tenant, differing ONLY in `employeeId`. That is the
     whole variable under test, so nothing else may move between them. */
  const sessionFor = (employeeId: string | null): Context => ({
    db,
    session: {
      userId,
      tenantId,
      employeeId,
      /* `notification.read` gates the bell; `asset.read` and `assets.view.all`
         let the queue counts run unscoped, so `clearance` is genuinely
         non-zero in case 4 rather than zero for an unrelated reason. */
      permissions: new Set<Permission>(["notification.read", "asset.read", "assets.view.all"]),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "notification-recipient-test-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  async function alertFor(employeeId: string, title: string): Promise<string> {
    const [n] = await db
      .insert(schema.notification)
      .values({ tenantId, recipientEmployeeId: employeeId, type: "request_declined", title, channel: "in_app" })
      .returning({ id: schema.notification.id });
    return n!.id;
  }

  beforeAll(async () => {
    db = createDb(url!);
    const suffix = crypto.randomUUID().slice(0, 8);

    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "Notification recipient test", slug: `notif-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;

    const [u] = await db
      .insert(schema.user)
      .values({
        tenantId,
        email: `notif-${suffix}@test.local`,
        passwordHash: "not-a-real-hash",
        firstName: "Notif",
        lastName: "Recipient",
      })
      .returning({ id: schema.user.id });
    userId = u!.id;

    const [a, b] = await db
      .insert(schema.employee)
      .values([
        { tenantId, name: "Holder of alerts" },
        { tenantId, name: "Someone else entirely" },
      ])
      .returning({ id: schema.employee.id });
    mine = a!.id;
    theirs = b!.id;
  });

  afterAll(async () => {
    if (db && tenantId) await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
    await db?.$client.end();
  });

  it("an account with no employee record is the recipient of nothing", async () => {
    await alertFor(mine, "Not approved: Repair requested: TEST-0001");
    await alertFor(theirs, "Not approved: Repair requested: TEST-0002");

    const bell = await dashboardRouter.createCaller(sessionFor(null)).notifications();

    /* Not "fewer than before" — zero. An employee-less account receives no
       alerts at all, which is what `notification.markRead`'s own comment has
       always claimed and what this query now agrees with. */
    expect(bell.alerts).toEqual([]);
    expect(bell.unread).toBe(0);

    const list = await notificationRouter.createCaller(sessionFor(null)).list();
    expect(list).toEqual([]);
  });

  it("an account with an employee record sees its own alerts and not the other's", async () => {
    const bell = await dashboardRouter.createCaller(sessionFor(mine)).notifications();

    const titles = bell.alerts.map((a) => a.title);
    expect(titles).toContain("Not approved: Repair requested: TEST-0001");
    expect(titles).not.toContain("Not approved: Repair requested: TEST-0002");

    const list = await notificationRouter.createCaller(sessionFor(mine)).list();
    expect(list.every((n) => n.recipientEmployeeId === mine)).toBe(true);
  });

  it("the badge counts every unread alert, not just the page the popover shows", async () => {
    /* Seven, because the alerts list is capped at five. Before the fix the
       badge read the length of that capped page and reported 5 to somebody
       holding 7 — under-reporting at exactly the moment the number matters. */
    for (let i = 3; i <= 9; i++) await alertFor(mine, `Backlog alert ${i}`);

    const bell = await dashboardRouter.createCaller(sessionFor(mine)).notifications();

    expect(bell.alerts).toHaveLength(5);
    expect(bell.unread).toBeGreaterThanOrEqual(8);
  });

  it("the deleted HR clearance gate is counted but never summed into the badge", async () => {
    /* A terminated employee still holding a tool: exactly what `clearance`
       counts. The offboarding gate that acted on it was removed on 2026-08-27,
       so this is a number with no screen behind it — reportable, not workable,
       and therefore not part of "how much is waiting for you". */
    const [gone] = await db
      .insert(schema.employee)
      .values({ tenantId, name: "Left the company", employmentStatus: "terminated" })
      .returning({ id: schema.employee.id });
    await db
      .insert(schema.asset)
      .values({ tenantId, currentCustodianId: gone!.id, currentStatus: "assigned" });

    const bell = await dashboardRouter.createCaller(sessionFor(mine)).notifications();

    expect(bell.queues.clearance).toBeGreaterThan(0);

    /* The badge is the alerts plus the three workable queues, and nothing
       else. Subtract the queues and what is left must be exactly the unread
       alerts that exist — if clearance crept back in, this overshoots. */
    const mineUnread = await db
      .select({ id: schema.notification.id })
      .from(schema.notification)
      .where(eq(schema.notification.recipientEmployeeId, mine));

    const queues = bell.queues.approvals + bell.queues.tasks + bell.queues.messages;
    expect(bell.unread - queues).toBe(mineUnread.length);
  });
});
