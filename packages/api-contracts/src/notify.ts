import { and, eq, ne } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";

/*
  Telling people what happened to the thing they asked for.

  A decision nobody hears about is not a decision — it is the request going
  quiet. `task.approve`/`task.decline` closed this loop from the start, but the
  custody approvals did not: a hand-off could be refused and the foreman who
  raised it would never learn why, because approve and decline only wrote to the
  transfer row.

  Everyone with a stake gets told: the person who asked, the person who was
  going to receive the tool, and the person who was holding it.
*/

export type CustodyDecision = {
  tenantId: string;
  /** `user.id` of whoever raised the request — mapped back to their employee row. */
  requestedByUserId?: string | null;
  toCustodianId?: string | null;
  fromCustodianId?: string | null;
  refType: "transfer" | "assignment";
  refId: string;
  assetTag: string;
  approved: boolean;
  reason?: string | null;
  /** Who decided, so the message can say. */
  decidedBy?: string | null;
};

export async function notifyCustodyDecision(db: any, d: CustodyDecision): Promise<number> {
  const recipients = new Set<string>();

  /* The requester is stored as a user; notifications address employees. The
     link lives on `user.employeeId`, and is null for desk logins that have no
     domain person behind them. */
  if (d.requestedByUserId) {
    const [u] = await db
      .select({ employeeId: schema.user.employeeId })
      .from(schema.user)
      .where(eq(schema.user.id, d.requestedByUserId))
      .limit(1);
    if (u?.employeeId) recipients.add(u.employeeId);
  }
  if (d.toCustodianId) recipients.add(d.toCustodianId);
  if (d.fromCustodianId) recipients.add(d.fromCustodianId);

  if (!recipients.size) return 0;

  const title = d.approved
    ? `Approved: ${d.assetTag} hand-off`
    : `Not approved: ${d.assetTag} hand-off`;

  const body = d.approved
    ? `The equipment desk signed this off.${d.decidedBy ? ` (${d.decidedBy})` : ""}`
    : /* The reason matters more on a refusal than an approval — it is the only
         thing that tells the foreman what to do next. */
      d.reason
      ? `${d.reason}. The tool stays where it is.`
      : "The tool stays where it is. Ask the equipment desk if you need it moved.";

  for (const employeeId of recipients) {
    await db.insert(schema.notification).values({
      tenantId: d.tenantId,
      recipientEmployeeId: employeeId,
      type: d.approved ? "request_approved" : "request_declined",
      refType: d.refType,
      refId: d.refId,
      title,
      body,
      channel: "in_app",
    });
  }
  return recipients.size;
}

/*
  Telling the desk that something is now waiting on them.

  The decision notifications above close the loop for whoever *asked*. Nothing
  closed it for whoever has to *act*: a hand-off held for a second signature, or
  a borrow recorded and awaiting verification, appeared only as a number on a
  dashboard widget somebody had to think to open. So the queue's arrival was
  silent, and the tool sat in the wrong truck until the desk happened to look.

  Who counts as "the desk" is `tenantSettings.custodyApproverRole` — a setting
  the settings page has always written and nothing has ever read. It falls back
  to `equipment_admin`, which is both the column default and the role
  `detectRentalsDue` already addresses for the same reason: the desk is who can
  actually act on the thing.

  The actor is excluded. An equipment admin raising a high-value hand-off does
  not need to be told they raised it — only their colleagues do.
*/
export type DeskPending = {
  tenantId: string;
  /** Falls back to `equipment_admin` when the tenant has not set one. */
  approverRole?: string | null;
  refType: "transfer" | "assignment";
  refId: string;
  assetTag: string | null;
  assetLabel: string;
  /** Employee id of whoever raised it, so they are not told about themselves. */
  actorEmployeeId?: string | null;
  /** Who it is going to, when that reads better than the tool alone. */
  toName?: string | null;
};

export async function notifyDeskPending(db: any, d: DeskPending): Promise<number> {
  const role = d.approverRole ?? "equipment_admin";

  const conditions = [
    eq(schema.employee.tenantId, d.tenantId),
    eq(schema.employee.employmentStatus, "active"),
    eq(schema.employee.role, role),
  ];
  if (d.actorEmployeeId) conditions.push(ne(schema.employee.id, d.actorEmployeeId));

  const desk = await db
    .select({ id: schema.employee.id })
    .from(schema.employee)
    .where(and(...conditions));

  if (!desk.length) return 0;

  const what = d.assetTag ? `${d.assetTag} — ${d.assetLabel}` : d.assetLabel;
  const title = `Waiting for approval: ${what}`;
  const body = `This one is held until somebody signs it off${
    d.toName ? `, then it goes to ${d.toName}` : ""
  }. The tool has not moved.`;

  for (const person of desk) {
    await db.insert(schema.notification).values({
      tenantId: d.tenantId,
      recipientEmployeeId: person.id,
      type: "approval_pending",
      refType: d.refType,
      refId: d.refId,
      title,
      body,
      channel: "in_app",
    });
  }
  return desk.length;
}
