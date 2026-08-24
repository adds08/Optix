import { eq } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import { decryptSecret } from "@stinventory/auth";
import type { MailConfig } from "@stinventory/mail";

/*
  Which SMTP config a tenant's mail actually goes out through.

  Mirrors `llmConfigFor` in routers/settings.ts on purpose: same shape, same
  reasoning. A tenant row with a host set WINS OUTRIGHT — no per-field merging
  with the environment, because a half-configured row silently completed from
  `SMTP_*` would send through a relay the tenant's own admin never chose and
  may not know exists. No host on the row means the tenant has not touched
  Settings yet, so `fallback` (the env vars, resolved once at boot in
  apps/api) is what keeps invites and resets working on a stack nobody has
  configured per-tenant.

  Exported so both `routers/user.ts` (an authenticated tRPC mutation) and
  apps/api's unauthenticated forgot-password/consume endpoints resolve the
  same config the same way — the alternative is two copies of "check the row,
  fall back to env" quietly drifting apart.
*/
export async function mailConfigFor(
  db: Database,
  tenantId: string,
  sessionSecret: string,
  fallback: MailConfig | null,
): Promise<MailConfig | null> {
  const [row] = await db
    .select({
      smtpHost: schema.tenantSettings.smtpHost,
      smtpPort: schema.tenantSettings.smtpPort,
      smtpUser: schema.tenantSettings.smtpUser,
      smtpPassEnc: schema.tenantSettings.smtpPassEnc,
      smtpFrom: schema.tenantSettings.smtpFrom,
    })
    .from(schema.tenantSettings)
    .where(eq(schema.tenantSettings.tenantId, tenantId))
    .limit(1);

  if (!row?.smtpHost) return fallback;

  return {
    host: row.smtpHost,
    port: row.smtpPort ?? 587,
    user: row.smtpUser ?? null,
    pass: row.smtpUser ? decryptSecret(row.smtpPassEnc, sessionSecret) : null,
    from: row.smtpFrom ?? fallback?.from ?? "STInventory <no-reply@stinventory.local>",
  };
}
