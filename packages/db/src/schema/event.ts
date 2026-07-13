import { bigint, boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant, user } from "./identity";
import { asset } from "./asset";
import { employee } from "./employee";

// The event log — append-only system of record. Nothing is ever updated or deleted.
// Every projection (assets.current_*, assignments) is a fold over this table.
export const transaction = pgTable(
  "transaction",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => asset.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // EventType
    actorId: uuid("actor_id").references(() => user.id, { onDelete: "set null" }),
    fromState: jsonb("from_state"),
    toState: jsonb("to_state"),
    refType: text("ref_type"), // assignment | transfer | maintenance | manual
    refId: uuid("ref_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  },
  (t) => ({
    tenantIdx: index("transaction_tenant_idx").on(t.tenantId),
    assetIdx: index("transaction_asset_idx").on(t.assetId),
    occurredIdx: index("transaction_occurred_idx").on(t.occurredAt),
  }),
);

export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    recipientEmployeeId: uuid("recipient_employee_id").references(() => employee.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id").references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // NotificationType
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    title: text("title").notNull(),
    body: text("body"),
    channel: text("channel").default("in_app"), // in_app | email | sms
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("notification_tenant_idx").on(t.tenantId),
    recipientIdx: index("notification_recipient_idx").on(t.recipientEmployeeId),
    typeIdx: index("notification_type_idx").on(t.type),
  }),
);

// Tenant-scoped settings (config, not code): high-value threshold, approver role,
// SLA cadences, delivery channels.
export const tenantSettings = pgTable("tenant_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
  highValueThreshold: jsonb("high_value_threshold").$type<number>(),
  custodyApproverRole: text("custody_approver_role").default("equipment_admin"),
  overdueEscalateAfterDays: jsonb("overdue_escalate_after_days").$type<number>(),
  missingReviewSlaDays: jsonb("missing_review_sla_days").$type<number>(),
  discrepancyReviewSlaDays: jsonb("discrepancy_review_sla_days").$type<number>(),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  smsEnabled: boolean("sms_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
