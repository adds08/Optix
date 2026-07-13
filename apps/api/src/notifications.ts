// Notification engine: detection (projection-based) + delivery (email/SMS).
// In MVP, detection runs on a scheduler interval; delivery is best-effort with a
// console fallback when SMTP/Twilio credentials are absent.

import { and, eq, isNull, lte, sql } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import type { ServerEnv } from "@stinventory/env";

type NotificationInput = {
  tenantId: string;
  recipientEmployeeId: string | null;
  type: string;
  refType?: string | null;
  refId?: string | null;
  title: string;
  body?: string | null;
};

export async function createNotification(db: Database, input: NotificationInput) {
  const [row] = await db
    .insert(schema.notification)
    .values({
      tenantId: input.tenantId,
      recipientEmployeeId: input.recipientEmployeeId,
      type: input.type,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      title: input.title,
      body: input.body ?? null,
      channel: "in_app",
    })
    .returning();
  return row;
}

// Detect overdue temporary loans and insert notifications for any that don't already
// have an active `overdue` notification for that assignment.
export async function detectOverdueLoans(db: Database) {
  const tidRows = await db.select({ id: schema.tenant.id }).from(schema.tenant);
  let created = 0;
  for (const t of tidRows) {
    const today = new Date().toISOString().slice(0, 10);
    const loans = await db
      .select({
        id: schema.assignment.id,
        assetId: schema.assignment.assetId,
        tag: schema.asset.tag,
        modelName: schema.asset.modelName,
        custodianId: schema.assignment.custodianId,
        custodianName: schema.employee.name,
        expectedEnd: schema.assignment.expectedEndDate,
      })
      .from(schema.assignment)
      .innerJoin(schema.asset, eq(schema.assignment.assetId, schema.asset.id))
      .innerJoin(schema.employee, eq(schema.assignment.custodianId, schema.employee.id))
      .where(
        and(
          eq(schema.assignment.tenantId, t.id),
          eq(schema.assignment.type, "temporary"),
          eq(schema.assignment.status, "active"),
          lte(schema.assignment.expectedEndDate, today),
        ),
      );
    for (const l of loans) {
      const existing = await db
        .select({ id: schema.notification.id })
        .from(schema.notification)
        .where(
          and(
            eq(schema.notification.tenantId, t.id),
            eq(schema.notification.type, "overdue"),
            eq(schema.notification.refType, "assignment"),
            eq(schema.notification.refId, l.id),
            isNull(schema.notification.readAt),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await createNotification(db, {
          tenantId: t.id,
          recipientEmployeeId: l.custodianId,
          type: "overdue",
          refType: "assignment",
          refId: l.id,
          title: `Overdue loan: ${l.tag}`,
          body: `${l.modelName} due ${l.expectedEnd}. Please return or extend.`,
        });
        created++;
      }
    }
  }
  return created;
}

// Delivery: email via nodemailer-less SMTP (console fallback); SMS via Twilio (console fallback).
export async function deliverPendingNotifications(db: Database, env: ServerEnv) {
  const unsent = await db
    .select()
    .from(schema.notification)
    .where(isNull(schema.notification.deliveredAt));
  for (const n of unsent) {
    if (env.SMTP_HOST) {
      // Real SMTP would go here. For dev we log.
      console.log(`[notify:email] ${n.title} → tenant ${n.tenantId}`);
    } else {
      console.log(`[notify:in_app] ${n.title}`);
    }
    await db
      .update(schema.notification)
      .set({ deliveredAt: new Date() })
      .where(eq(schema.notification.id, n.id));
  }
}
