import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/*
  Cost 12, not 10.

  bcrypt cost is a deliberate slowdown, and hardware gets faster every year
  while the number in the code does not. 10 was a reasonable default a decade
  ago; 12 is roughly four times the work and still comfortably under 250ms on
  the hardware this will run on. Existing hashes keep working — bcrypt encodes
  its cost in the hash, so `compare` uses whatever each hash was made with, and
  old ones are upgraded on next login.
*/
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/** True when a stored hash was made with a weaker cost than we now use. */
export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) < BCRYPT_COST;
  } catch {
    /* Not a bcrypt hash at all — leave it alone rather than guess. */
    return false;
  }
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export type LoginResult =
  | { ok: true; sessionId: string; userId: string; tenantId: string }
  | { ok: false; reason: "invalid_credentials" | "inactive" };

export async function login(db: Database, email: string, password: string): Promise<LoginResult> {
  const u = await db.query.user.findFirst({ where: eq(schema.user.email, email) });
  if (!u) return { ok: false, reason: "invalid_credentials" };
  if (!u.isActive) return { ok: false, reason: "inactive" };
  const ok = await verifyPassword(password, u.passwordHash);
  if (!ok) return { ok: false, reason: "invalid_credentials" };

  /* Transparent upgrade: the only moment the plaintext is available is right
     here, so a password hashed at the old cost is re-hashed on the way past.
     Failure is deliberately swallowed — a login must not fail because of a
     background improvement. */
  if (needsRehash(u.passwordHash)) {
    try {
      await db
        .update(schema.user)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(schema.user.id, u.id));
    } catch {
      /* keep going; it will be retried on the next login */
    }
  }

  /* 32 bytes, not 24. This is the bearer token for the whole session. */
  const sessionId = randomBytes(32).toString("hex");
  await db.insert(schema.session).values({
    id: sessionId,
    userId: u.id,
    tenantId: u.tenantId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return { ok: true, sessionId, userId: u.id, tenantId: u.tenantId };
}

export async function logout(db: Database, sessionId: string): Promise<void> {
  await db.delete(schema.session).where(eq(schema.session.id, sessionId));
}

export type ResolvedSession = {
  userId: string;
  tenantId: string;
  employeeId: string | null;
  permissions: ReadonlySet<Permission>;
  roleName: string | null;
  actorLabel: string | null;
};

export async function resolveSession(
  db: Database,
  sessionId: string | null | undefined,
): Promise<ResolvedSession | null> {
  if (!sessionId) return null;
  const s = await db.query.session.findFirst({
    where: and(eq(schema.session.id, sessionId), gt(schema.session.expiresAt, new Date())),
  });
  if (!s) return null;
  const u = await db.query.user.findFirst({ where: eq(schema.user.id, s.userId) });
  if (!u || !u.isActive) return null;

  const perms = await db
    .select({ name: schema.rolePermission.permissionName, roleName: schema.role.name })
    .from(schema.userRole)
    .innerJoin(schema.rolePermission, eq(schema.userRole.roleId, schema.rolePermission.roleId))
    .innerJoin(schema.role, eq(schema.userRole.roleId, schema.role.id))
    .where(eq(schema.userRole.userId, u.id));

  return {
    userId: u.id,
    tenantId: u.tenantId,
    employeeId: u.employeeId,
    permissions: new Set(perms.map((p) => p.name as Permission)),
    roleName: perms[0]?.roleName ?? null,
    actorLabel: `${u.firstName} ${u.lastName} (${u.email})`,
  };
}

export function hasPermission(session: ResolvedSession | null, perm: Permission): boolean {
  return !!session?.permissions.has(perm);
}

export { encryptSecret, decryptSecret, secretHint } from "./secrets.js";
