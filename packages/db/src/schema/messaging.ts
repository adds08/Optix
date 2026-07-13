import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";
import { user } from "./identity";
import { employee } from "./employee";

export const channel = pgTable(
  "channel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull().default("department"),
    memberRole: text("member_role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("channel_tenant_idx").on(t.tenantId),
    slugIdx: index("channel_slug_idx").on(t.slug),
  }),
);

export const message = pgTable(
  "message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull().references(() => channel.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").notNull().references(() => user.id, { onDelete: "set null" }),
    authorEmployeeId: uuid("author_employee_id").references(() => employee.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    processingStatus: text("processing_status").notNull().default("queued"),
    intentType: text("intent_type"),
    intentPayload: jsonb("intent_payload"),
    proposedAction: jsonb("proposed_action"),
    executedTransactionIds: jsonb("executed_transaction_ids"),
    handledByUserId: uuid("handled_by_user_id").references(() => user.id, { onDelete: "set null" }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    errorNote: text("error_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("message_tenant_idx").on(t.tenantId),
    channelIdx: index("message_channel_idx").on(t.channelId),
    statusIdx: index("message_status_idx").on(t.processingStatus),
  }),
);
