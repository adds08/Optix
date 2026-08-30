import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";

// Generic audit log (mirrors Mark 85 event_log). Best-effort insert; never the
// system of record for domain state (that is `transaction`).
export const eventLog = pgTable(
  "tbl_ops_event_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id").references(() => tenant.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id"),
    actorRole: text("actor_role"),
    actorLabel: text("actor_label"),
    category: text("category").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    entityLabel: text("entity_label"),
    result: text("result").notNull().default("success"),
    errorMessage: text("error_message"),
    source: text("source").default("api"),
    httpMethod: text("http_method"),
    httpPath: text("http_path"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("event_log_tenant_idx").on(t.tenantId),
    createdAtIdx: index("event_log_created_idx").on(t.createdAt),
  }),
);
