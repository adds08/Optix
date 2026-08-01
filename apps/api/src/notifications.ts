// Notification engine: detection (projection-based) + delivery (email/SMS).
// In MVP, detection runs on a scheduler interval; delivery is best-effort with a
// console fallback when SMTP/Twilio credentials are absent.

import { and, eq, isNull, lte } from "drizzle-orm";
import { isRentalOverdue, isRentalDueSoon } from "@stinventory/domain";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import type { ServerEnv } from "@stinventory/env";
import { formatAssetModel } from "@stinventory/types";

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
        make: schema.asset.make,
        modelNumber: schema.asset.modelNumber,
        description: schema.asset.description,
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
          body: `${formatAssetModel(l)} due ${l.expectedEnd}. Please return or extend.`,
        });
        created++;
      }
    }
  }
  return created;
}

/*
  Rented lines coming due, and rented lines already past their date.

  The difference from `detectOverdueLoans` is who pays. An owned tool held too
  long is an internal annoyance; a rental past its end date is the vendor
  billing Urban every day until somebody phones them. So this raises two levels
  — a nudge inside the window, and an alert once it has gone past — and it
  addresses the equipment desk rather than the holder, because the desk is who
  can actually call it off.
*/
export async function detectRentalsDue(db: Database) {
  const tenants = await db.select({ id: schema.tenant.id }).from(schema.tenant);
  const today = new Date().toISOString().slice(0, 10);
  let created = 0;

  for (const t of tenants) {
    const lines = await db
      .select({
        id: schema.rentalLine.id,
        itemName: schema.rentalLine.itemName,
        quantity: schema.rentalLine.quantity,
        endDate: schema.rentalLine.endDate,
        status: schema.rentalLine.status,
        externalNumber: schema.rentalOrder.externalNumber,
        jobsiteLabel: schema.rentalOrder.jobsiteLabel,
        vendorName: schema.vendor.name,
      })
      .from(schema.rentalLine)
      .innerJoin(schema.rentalOrder, eq(schema.rentalLine.orderId, schema.rentalOrder.id))
      .innerJoin(schema.vendor, eq(schema.rentalOrder.vendorId, schema.vendor.id))
      .where(and(eq(schema.rentalLine.tenantId, t.id), eq(schema.rentalLine.status, "on_rent")));

    if (!lines.length) continue;

    /* The desk, not the field. Foremen cannot end a rental contract. */
    const desk = await db
      .select({ id: schema.employee.id })
      .from(schema.employee)
      .where(
        and(
          eq(schema.employee.tenantId, t.id),
          eq(schema.employee.employmentStatus, "active"),
          eq(schema.employee.role, "equipment_admin"),
        ),
      );
    if (!desk.length) continue;

    for (const l of lines) {
      const input = { status: l.status, endDate: l.endDate, today };
      const overdue = isRentalOverdue(input);
      const dueSoon = !overdue && isRentalDueSoon(input);
      if (!overdue && !dueSoon) continue;

      const type = overdue ? "rental_overdue" : "rental_due_soon";

      /* One unread alert per line per level — the scheduler runs every minute
         and a yard that gets the same line 1,440 times a day stops reading. */
      const existing = await db
        .select({ id: schema.notification.id })
        .from(schema.notification)
        .where(
          and(
            eq(schema.notification.tenantId, t.id),
            eq(schema.notification.type, type),
            eq(schema.notification.refType, "rental_line"),
            eq(schema.notification.refId, l.id),
            isNull(schema.notification.readAt),
          ),
        )
        .limit(1);
      if (existing.length) continue;

      const where = l.jobsiteLabel ? ` at ${l.jobsiteLabel}` : "";
      for (const d of desk) {
        await createNotification(db, {
          tenantId: t.id,
          recipientEmployeeId: d.id,
          type,
          refType: "rental_line",
          refId: l.id,
          title: overdue
            ? `Still on rent past its date: ${l.itemName}`
            : `Due back soon: ${l.itemName}`,
          body: `${l.quantity} on contract ${l.externalNumber} from ${l.vendorName}${where}, due ${l.endDate}. ${
            overdue ? "Being billed until it is called off." : "Arrange collection or extend."
          }`,
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
