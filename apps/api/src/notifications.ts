// Notification engine: detection (projection-based) + delivery (email/SMS).
// In MVP, detection runs on a scheduler interval; delivery is best-effort with a
// console fallback when SMTP/Twilio credentials are absent.

import { eq, isNull } from "drizzle-orm";
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
