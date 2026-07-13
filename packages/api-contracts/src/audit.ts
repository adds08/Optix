import * as schema from "@stinventory/db/schema";
import type { Context } from "./trpc.js";

export type AuditCategory =
  | "auth"
  | "asset"
  | "assignment"
  | "transfer"
  | "project"
  | "location"
  | "vehicle"
  | "notification"
  | "messaging"
  | "system";

export type AuditEvent = {
  category: AuditCategory;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  result?: "success" | "failure";
  errorMessage?: string | null;
  details?: Record<string, unknown> | null;
};

export async function logEvent(ctx: Context, e: AuditEvent): Promise<void> {
  try {
    await ctx.db.insert(schema.eventLog).values({
      tenantId: ctx.session?.tenantId ?? null,
      actorUserId: ctx.session?.userId ?? null,
      actorRole: ctx.session?.roleName ?? null,
      actorLabel: ctx.session?.actorLabel ?? null,
      category: e.category,
      action: e.action,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      entityLabel: e.entityLabel ?? null,
      source: ctx.request.source,
      httpMethod: ctx.request.method,
      httpPath: ctx.request.path,
      ip: ctx.request.ip,
      userAgent: ctx.request.userAgent,
      result: e.result ?? "success",
      errorMessage: e.errorMessage ?? null,
      details: e.details ?? null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[audit] logEvent failed", err);
  }
}
