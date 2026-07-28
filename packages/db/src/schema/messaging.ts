import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    // Same reason as task.created_by_user_id: NOT NULL alongside
    // `on delete set null` makes deleting a user violate this constraint.
    // The message body and its resulting transactions are the record; the
    // author link is metadata that may outlive the account.
    authorUserId: uuid("author_user_id").references(() => user.id, { onDelete: "set null" }),
    authorEmployeeId: uuid("author_employee_id").references(() => employee.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    // Entities the author picked from the @ list rather than merely described.
    // [{ kind, id, label }]. These are resolved at type time and outrank
    // anything the parser infers from the wording — see packages/types/mentions.
    mentions: jsonb("mentions"),
    processingStatus: text("processing_status").notNull().default("queued"),
    intentType: text("intent_type"),
    intentPayload: jsonb("intent_payload"),
    proposedAction: jsonb("proposed_action"),
    executedTransactionIds: jsonb("executed_transaction_ids"),
    handledByUserId: uuid("handled_by_user_id").references(() => user.id, { onDelete: "set null" }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    errorNote: text("error_note"),
    /* How many times the worker has tried to parse this. A message that failed
       because the parser was unreachable is retryable; one that has failed
       repeatedly is a job for the desk, not an infinite loop. */
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("message_tenant_idx").on(t.tenantId),
    channelIdx: index("message_channel_idx").on(t.channelId),
    statusIdx: index("message_status_idx").on(t.processingStatus),
  }),
);
