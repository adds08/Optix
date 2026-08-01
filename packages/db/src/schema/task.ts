import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";
import { user } from "./identity";
import { employee } from "./employee";
import { asset } from "./asset";
import { project } from "./project";

export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("pending"),
    priority: text("priority").notNull().default("medium"),
    assignedToEmployeeId: uuid("assigned_to_employee_id").references(() => employee.id, { onDelete: "set null" }),
    // Nullable on purpose: the FK is `on delete set null`, so a NOT NULL here
    // makes deleting a user violate this table's own constraint. A task
    // outliving the account that raised it is fine — the body still says what
    // needs doing.
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    relatedAssetId: uuid("related_asset_id").references(() => asset.id, { onDelete: "set null" }),
    relatedProjectId: uuid("related_project_id").references(() => project.id, { onDelete: "set null" }),
    source: text("source").notNull().default("chat"),
    sourceMessageId: uuid("source_message_id"),
    /*
      What this task will DO when someone signs it off.

      A request raised by somebody without the permission it costs used to be
      recorded as prose — "Repair requested: UIC-1008" — and the action itself
      was discarded. That left the desk reading a sentence with no way to act
      on it but to retype the whole thing into a form, which is why the approve
      button had nothing to call.

      `actionType` is the verb; `pendingAction` is the exact ChatAction payload
      the requester's message resolved to. Approving replays it through the
      same executor every other path uses, so an approved request and a
      directly-applied one are indistinguishable in the ledger.
    */
    actionType: text("action_type"),
    pendingAction: jsonb("pending_action"),
    /*
      The intelligent inbox's buckets (docs/19).

      `recognized` — the task carries an actionType + pendingAction that can be
      replayed, or the message it came from resolved to real entities.
      `completed` — terminal state; history, not work.
      `unrecognized` — the model could not bind this to an action; a human has
      to resolve or dismiss it.

      Set by the request worker's sweep, idempotently — nothing here is written
      by the frontend.
    */
    classification: text("classification"),
    /* The LLM's one-sentence reading of the item, for the Recognized and
       Unrecognized rows. Populated at classification time, nullable when the
       classifier was deterministic and had nothing to say. */
    llmSummary: text("llm_summary"),
    /* Who asked. `createdByUserId` can be null once an account is deleted, and
       the desk still needs to know whose request this was. */
    requestedByEmployeeId: uuid("requested_by_employee_id").references(() => employee.id, { onDelete: "set null" }),
    /* Which desk owns it — Maintenance, Procurement, Equipment Yard. Set from
       departmentForAction at request time. */
    department: text("department"),
    declineReason: text("decline_reason"),
    /* Escalation bookkeeping for the request worker: how many times the desk
       has been nudged, and when it last happened. */
    escalationCount: integer("escalation_count").notNull().default(0),
    lastEscalatedAt: timestamp("last_escalated_at", { withTimezone: true }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("task_tenant_idx").on(t.tenantId),
    statusIdx: index("task_status_idx").on(t.status),
    assigneeIdx: index("task_assignee_idx").on(t.assignedToEmployeeId),
  }),
);
