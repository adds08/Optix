import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb } from "@stinventory/db";
import * as schema from "@stinventory/db/schema";
import { adaptBambooEmployee } from "@stinventory/domain";
import { applySyncPlan, buildSyncPlan, loadExisting } from "./bamboo-sync.js";

/*
  Phones land in `employee_contact`, and a re-run does not duplicate them.

  Until 2026-09-10 the adapter built `contacts[]` and nothing persisted it — the
  numbers reached `raw` jsonb and stopped, so the yard had no number to call for
  anybody who came from HR. These tests are the writer's, not the adapter's:
  `packages/domain/src/bamboohr.test.ts` already proves `contacts[]` is BUILT
  correctly, and proving that again here would not have caught this.

  The re-run case is the one that matters. There is no unique index on
  (employee_id, kind) — only `one_primary_uq` — so an appending writer looks
  correct on the first sync and silently grows a duplicate mobile on every pass
  after it.
*/
describe.skipIf(!process.env.DATABASE_URL)("BambooHR sync writes phone numbers", () => {
  let db: ReturnType<typeof createDb>;
  let tid: string;

  /* One person, both numbers. `employeeId` is Bamboo's PK and the match key. */
  const bamboo = (over: Record<string, unknown> = {}) => ({
    id: "5001",
    employeeId: "5001",
    firstName: "Maria",
    lastName: "Delgado",
    jobTitleName: "Foreman",
    status: "Active",
    mobilePhone: "214-555-0101",
    workPhone: "214-555-0900",
    ...over,
  });

  const sync = async (records: Record<string, unknown>[]) => {
    const people = records.map((r) => adaptBambooEmployee(r)).flatMap((r) => (r.ok ? [r.person] : []));
    const existing = await loadExisting(db, tid);
    const plan = buildSyncPlan(people, [], existing);
    return applySyncPlan(db, tid, plan, people, new Map());
  };

  const contactsFor = async (name: string) => {
    const [person] = await db
      .select({ id: schema.employee.id, phone: schema.employee.phone })
      .from(schema.employee)
      .where(and(eq(schema.employee.tenantId, tid), eq(schema.employee.name, name)));
    const rows = await db
      .select({ kind: schema.employeeContact.kind, value: schema.employeeContact.value, isPrimary: schema.employeeContact.isPrimary })
      .from(schema.employeeContact)
      .where(and(eq(schema.employeeContact.tenantId, tid), eq(schema.employeeContact.employeeId, person!.id)));
    return { person: person!, rows };
  };

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "Bamboo contacts", slug: `bamboo-contacts-${crypto.randomUUID()}` })
      .returning();
    tid = t!.id;
  });

  it("persists the mobile and the work line, and marks the mobile primary", async () => {
    await sync([bamboo()]);
    const { rows } = await contactsFor("Maria Delgado");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.kind === "mobile")).toMatchObject({ value: "214-555-0101", isPrimary: true });
    /* Exactly one row may claim primary — `one_primary_uq` is a partial unique
       index, so a writer that marked both would abort this person entirely. */
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
    expect(rows.find((r) => r.kind === "work")).toMatchObject({ value: "214-555-0900", isPrimary: false });
  });

  it("keeps employee.phone in step with the primary number", async () => {
    const { person } = await contactsFor("Maria Delgado");
    /* Not dropped and not duplicated: every screen still reads this column, so
       it holds the primary while `employee_contact` fills up beside it. */
    expect(person.phone).toBe("214-555-0101");
  });

  it("does not duplicate on a re-run, and follows a changed number", async () => {
    await sync([bamboo({ mobilePhone: "214-555-0202" })]);
    const { person, rows } = await contactsFor("Maria Delgado");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.kind === "mobile")?.value).toBe("214-555-0202");
    expect(person.phone).toBe("214-555-0202");
  });

  it("makes the work line primary when there is no mobile", async () => {
    await sync([bamboo({ employeeId: "5002", id: "5002", firstName: "Desk", lastName: "Only", mobilePhone: undefined })]);
    const { person, rows } = await contactsFor("Desk Only");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "work", isPrimary: true });
    expect(person.phone).toBe("214-555-0900");
  });

  it("leaves a hand-typed personal number alone", async () => {
    const { person } = await contactsFor("Maria Delgado");
    await db.insert(schema.employeeContact).values({
      tenantId: tid,
      employeeId: person.id,
      kind: "personal",
      value: "214-555-0303",
      isPrimary: false,
      note: "Typed at the desk",
    });
    await sync([bamboo()]);
    const { rows } = await contactsFor("Maria Delgado");
    /* HR owns `mobile` and `work`. A number the desk added is not HR's to
       delete, and this sync must never become the thing that quietly drops it. */
    expect(rows.find((r) => r.kind === "personal")?.value).toBe("214-555-0303");
    expect(rows).toHaveLength(3);
  });
});
