// Notification engine: detection (projection-based) + delivery (email/SMS).
// In MVP, detection runs on a scheduler interval; delivery is real for email
// (the invite/reset build, 2026-08-24) with a console fallback when no SMTP is
// configured anywhere, and still a placeholder for SMS — see the header on
// `tenantSettings.smsEnabled` in packages/db/src/schema/event.ts.

import { and, eq, isNull, lt } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import { mailConfigFor } from "@stinventory/api-contracts";
import { esc, sendMail, type MailConfig } from "@stinventory/mail";

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

/*
  A relay that is down forever must not retry forever. Five is generous for a
  transient outage (each sweep is 60s, so five attempts spans several minutes)
  and small enough that a genuinely broken config stops nagging the log
  quickly — `tenantSettings.smtpLastCheckError` from a real test-send is the
  place to actually diagnose it, not this loop's stderr.
*/
const MAX_DELIVERY_ATTEMPTS = 5;

/*
  Delivery: email actually sends now, through whatever `mailConfigFor`
  resolves — a tenant's own SMTP row, or `mailFallback` (the `SMTP_*` env vars,
  resolved once at boot). SMS stays a placeholder; `smsEnabled` on Settings
  does nothing yet and this loop never looks at it.

  `deliveredAt` is unrelated to the in-app bell — no router or screen reads
  it (verified) — so bounding retries here can only ever change whether the
  OUTSIDE-the-app copy of an alert goes anywhere, never whether it shows up on
  the desk.
*/
export async function deliverPendingNotifications(
  db: Database,
  sessionSecret: string,
  mailFallback: MailConfig | null,
) {
  const unsent = await db
    .select({
      id: schema.notification.id,
      tenantId: schema.notification.tenantId,
      recipientEmployeeId: schema.notification.recipientEmployeeId,
      title: schema.notification.title,
      body: schema.notification.body,
      deliveryAttempts: schema.notification.deliveryAttempts,
    })
    .from(schema.notification)
    .where(and(isNull(schema.notification.deliveredAt), lt(schema.notification.deliveryAttempts, MAX_DELIVERY_ATTEMPTS)));

  for (const n of unsent) {
    const [settings] = await db
      .select({ emailEnabled: schema.tenantSettings.emailEnabled })
      .from(schema.tenantSettings)
      .where(eq(schema.tenantSettings.tenantId, n.tenantId))
      .limit(1);

    /* No email to attempt: the channel is off, there is no linked employee, or
       the employee has none on file. The in-app row already carries the
       alert, so this is a normal outcome, not a failure — mark it done and
       move on rather than retrying something that can never succeed. */
    const employee = n.recipientEmployeeId
      ? (
          await db
            .select({ email: schema.employee.email })
            .from(schema.employee)
            .where(eq(schema.employee.id, n.recipientEmployeeId))
            .limit(1)
        )[0]
      : null;

    if (!settings?.emailEnabled || !employee?.email) {
      await db
        .update(schema.notification)
        .set({ deliveredAt: new Date(), lastAttemptAt: new Date() })
        .where(eq(schema.notification.id, n.id));
      continue;
    }

    const config = await mailConfigFor(db, n.tenantId, sessionSecret, mailFallback);
    const body = n.body ?? n.title;
    const result = await sendMail(config, {
      to: employee.email,
      subject: n.title,
      html: `<p>${esc(body)}</p>`,
      text: body,
    });

    if (result.ok) {
      await db
        .update(schema.notification)
        .set({ deliveredAt: new Date(), deliveryError: null, lastAttemptAt: new Date() })
        .where(eq(schema.notification.id, n.id));
    } else {
      await db
        .update(schema.notification)
        .set({
          deliveryAttempts: n.deliveryAttempts + 1,
          deliveryError: result.error.slice(0, 500),
          lastAttemptAt: new Date(),
        })
        .where(eq(schema.notification.id, n.id));
    }
  }
}
