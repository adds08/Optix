import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant, user } from "./identity";
import { asset } from "./asset";
import { employee } from "./employee";

// The event log — append-only system of record. Nothing is ever updated or deleted:
// enforced at the database by BEFORE UPDATE/DELETE/TRUNCATE triggers
// (drizzle/0014_append_only_ledger.sql, STI-104) that raise SQLSTATE 0A000 —
// corrections are compensating INSERTs. Custom migrations are invisible to the
// drizzle differ, so a later `generate` will never drop them. Two sanctioned
// exceptions disable the trigger around their deletes, both inside a single
// transaction so an abort re-arms it: the seed's SEED_RESET wipe (src/seed.ts) and
// the append-only test's cleanup (api-contracts/src/ledger-append-only.test.ts).
// Every projection (assets.current_*, assignments) is a fold over this table.
export const transaction = pgTable(
  "tbl_ops_transaction",
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
    /*
      Which chat message caused this event, if one did (STI-120).

      `refType`/`refId` name the ROW the event is about — for a chat-driven
      assign they hold `assignment`/<assignment id>, which means the chat
      provenance was lost entirely: nothing in the ledger recorded that a
      sentence somebody typed is why a tool moved.

      That absence was also a correctness problem, not only a reporting one.
      `applyChatAction` writes one asset per transaction, so a multi-asset
      action that fails partway leaves some applied; the caller un-claims the
      message and the Confirm button works again, and pressing it re-applied
      the ones that had already landed — permanent duplicate history in a log
      that cannot be pruned, with no crash required. Idempotency needs a key,
      and "which message did this" is the key. It is here rather than folded
      into `refType`/`refId` because an event has both a subject and a cause,
      and overloading one pair to carry two facts is what lost the cause.

      Nullable, and null means "not from a message" OR "written before this
      column existed" — the same honest-unknown the vehicle keys use. No
      backfill: the 754 genesis rows predate chat and inventing a link for
      them would be worse than saying nothing.
    */
    refMessageId: uuid("ref_message_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  },
  (t) => ({
    tenantIdx: index("transaction_tenant_idx").on(t.tenantId),
    assetIdx: index("transaction_asset_idx").on(t.assetId),
    occurredIdx: index("transaction_occurred_idx").on(t.occurredAt),
    /* The idempotency lookup is (asset, message) — indexed together because
       that is the question the retry guard asks on every asset it touches. */
    refMessageIdx: index("transaction_ref_message_idx").on(t.refMessageId, t.assetId),
  }),
);

export const notification = pgTable(
  "tbl_ops_notification",
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
    /*
      Delivery failure and retry (the invite/reset build, 2026-08-24).

      Before this, `deliverPendingNotifications` stamped `deliveredAt`
      unconditionally — a `console.log` "succeeded" every time, so once real
      SMTP existed a failed send would vanish just as silently as a fake one
      always had. Nothing here changes what `deliveredAt` means to the
      in-app bell: it is read by no router and no screen (verified), so
      bounding retries can never make an alert disappear from the desk —
      only ever change whether its OUTSIDE-the-app copy went anywhere.

      `deliveryAttempts` caps at `MAX_DELIVERY_ATTEMPTS` (notifications.ts) so
      a relay that is down forever does not retry forever; `deliveryError`
      carries the provider's own words for whoever is diagnosing it, the same
      shape `smtpLastCheckError` already uses on `tenant_settings`.
    */
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    deliveryError: text("delivery_error"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
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
export const tenantSettings = pgTable("tbl_entity_tenant_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
  highValueThreshold: jsonb("high_value_threshold").$type<number>(),
  custodyApproverRole: text("custody_approver_role").default("equipment_admin"),
  overdueEscalateAfterDays: jsonb("overdue_escalate_after_days").$type<number>(),
  missingReviewSlaDays: jsonb("missing_review_sla_days").$type<number>(),
  discrepancyReviewSlaDays: jsonb("discrepancy_review_sla_days").$type<number>(),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  smsEnabled: boolean("sms_enabled").notNull().default(false),

  /*
    Intent parser configuration, per tenant.

    These used to be environment variables on the engine container, which meant
    changing the model was an ssh session and a restart — fine for the person
    who deployed it, impossible for the equipment manager who actually decides
    whether the thing is worth paying for. The engine stays stateless: the API
    reads these and passes them with each parse request.

    `llmApiKeyEnc` is encrypted at rest (AES-256-GCM, key derived from
    SESSION_SECRET — see packages/auth/src/secrets.ts) and is never returned to
    a browser. Rotating SESSION_SECRET makes stored keys unreadable and they
    must be re-entered; that tradeoff is deliberate, since the alternative is a
    second key to manage.
  */
  llmEnabled: boolean("llm_enabled").notNull().default(false),
  llmBaseUrl: text("llm_base_url"),
  llmModel: text("llm_model"),
  llmApiKeyEnc: text("llm_api_key_enc"),
  /* Last four characters, kept in the clear so the UI can show which key is in
     place without ever decrypting it. */
  llmApiKeyHint: text("llm_api_key_hint"),
  llmTimeoutMs: integer("llm_timeout_ms").notNull().default(15000),
  /* Result of the last "test connection", so the page can say something
     truthful about whether this config has ever worked. */
  llmLastCheckedAt: timestamp("llm_last_checked_at", { withTimezone: true }),
  llmLastCheckOk: boolean("llm_last_check_ok"),
  llmLastCheckError: text("llm_last_check_error"),

  /*
    SMTP, per tenant — the same shape as the LLM config above, for the same
    reason: which mail relay sends a tenant's invites used to be a question
    only whoever held the container's environment could answer.

    Every column here is optional, and that is deliberate: `smtpConfigFor`
    (apps/api/src/mail.ts) falls back to the `SMTP_*` env vars when a tenant
    has set none of these, so a fresh stack and every tenant that has not
    visited Settings keep working exactly as before this existed. Once a
    tenant sets a host here, the row wins outright — no per-field merging with
    the environment, so a half-configured row can never be silently completed
    from a relay some other tenant's admin does not know exists.

    `smtpPassEnc`/`smtpPassHint` mirror `llmApiKeyEnc`/`llmApiKeyHint` exactly:
    AES-256-GCM at rest, decrypted only server-side, never returned to a
    browser. See the rationale comment above `llmApiKeyEnc`.
  */
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPassEnc: text("smtp_pass_enc"),
  smtpPassHint: text("smtp_pass_hint"),
  smtpFrom: text("smtp_from"),
  /* Result of the last "send test email", so the page can say something
     truthful about whether this config has ever actually delivered. */
  smtpLastCheckedAt: timestamp("smtp_last_checked_at", { withTimezone: true }),
  smtpLastCheckOk: boolean("smtp_last_check_ok"),
  smtpLastCheckError: text("smtp_last_check_error"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
