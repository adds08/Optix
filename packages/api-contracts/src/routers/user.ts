import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import { hashPassword, verifyPassword } from "@stinventory/auth";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

/*
  User administration — the login accounts, and nothing else.

  **Employees are not users.** `employee` is the register of the people who
  hold tools; `user` is the set of people who can sign in. A foreman holding
  nineteen tools may have no account at all and must not be given one just to
  appear in custody. `user.employeeId` is a plain uuid with NO foreign key (see
  the schema comment in `identity.ts`) — it is the optional link between the two
  registers, nullable from either side, and this router is the only writer of
  it. Because there is no FK, nothing but an explicit tenant predicate on the
  employee lookup stops a link naming somebody in another tenant; every place
  that reads or writes it below carries one.

  **Deactivate, never delete.** A user is the actor stamped on `event_log` rows
  and on ledger history that can never be rewritten. Deleting the row cascades
  those links away and leaves a trail nobody can attribute — the same reasoning
  as `employee.delete`, which refuses for the same reason. `isActive = false` is
  the whole of "this person has left": `resolveSession` refuses an inactive
  user, so live sessions stop working at their next request without anything
  having to hunt them down.

  **Deactivating an account does NOT move custody**, deliberately. Tools follow
  the person, and the person is the `employee`, not the login. `list` reports
  how many tools the linked employee still holds so the screen can say so out
  loud — a read-only count, and nothing here writes custody. Moving them is
  departure reassignment (STI-306); conflating the two is how a tool silently
  vanishes from the register while its holder's account quietly goes dark.

  Permission: `config.manage` on every ADMINISTRATIVE procedure, reads
  included — the account list is the list of who can get in. There is no
  `user.manage` in `packages/types/src/index.ts`; inventing one would need a
  seed change, so `config.manage` (held by `owner` and `equipment_admin`) is
  the closest existing fit, exactly as the ticket allows.

  The one deliberate exception is `changePassword`, which is `protectedProcedure`
  and scoped to the caller's OWN `ctx.session.userId`. Gating it on
  `config.manage` would mean nobody but an administrator could change their own
  password — which is not a stricter control, it is a broken one, because
  `mustChangePassword` would then be unsatisfiable for every ordinary account.
  Its scope check is written out at the procedure and is what stands in for a
  permission there.

  No procedure in this file RETURNS or logs `passwordHash`. Exactly one selects
  it — `changePassword`, to verify the current password — and it is compared and
  dropped inside the resolver, never put on a result.
*/

/*
  Password reset hands the desk a temporary credential, once — and the account
  is then FORCED to change it (criterion 5, both halves).

  The two designs on offer were a must-change-on-next-login flag and a one-time
  link. The link needs a token table and an UNAUTHENTICATED endpoint on
  `apps/api` to spend it; the flag needs one boolean column. The flag won on
  size for the same guarantee, and it is `user.must_change_password`.

  The three moving parts, and why each is where it is:

    - `create` and `resetPassword` SET the flag. Both hand a credential to
      somebody other than its owner, so in both cases a second person knows the
      password. That is true even when the admin typed it rather than letting
      the server generate one — an admin-chosen password is still an
      admin-known password.
    - `changePassword` CLEARS it, and is the reason the flag is a prompt rather
      than a lockout. A flag with no self-service way to satisfy it is not a
      security control, it is a bricked account: the ONLY procedure that could
      clear it would be `resetPassword`, which needs `config.manage`, so every
      user would need an admin to change their own password.
    - `login()` (packages/auth) REPORTS the flag and does not refuse on it,
      because changing a password needs a session.

  What the reset carries besides the flag:

    - the plaintext is returned exactly ONCE, in the mutation result, to the
      admin who asked for it. It is never persisted and never written to the
      audit log, which records only that a reset happened and to whom.
    - every session the user holds is deleted. A reset that left the old bearer
      token working would revoke nothing, which is the usual reason somebody
      resets a password in the first place.
*/
function generatePassword(): string {
  /* base64url so it survives being read down a phone line and pasted back —
     no `+`, `/` or `=` to mis-hear. 12 bytes is 16 characters. */
  return randomBytes(12).toString("base64url");
}

/*
  STI-305 put `user_tenant_email_uq` on (tenant_id, email), so a second account
  on one address now fails at the database — as a raw 23505 whose message names
  the index. That text is machine text: `errorFormatter` only redacts
  INTERNAL_SERVER_ERROR, and an uncaught driver error arrives as exactly that,
  so the user would see the generic line and never learn what was wrong. The
  pre-check below is what makes the refusal readable; this catch is not
  redundant, because two admins creating the same address at once both pass the
  pre-check and one of them loses at commit.
*/
function isDuplicateEmail(err: unknown): boolean {
  const e = err as { code?: string; constraint_name?: string; message?: string } | null;
  if (!e || e.code !== "23505") return false;
  return `${e.constraint_name ?? ""} ${e.message ?? ""}`.includes("user_tenant_email_uq");
}

const duplicateEmail = (email: string) =>
  new TRPCError({ code: "CONFLICT", message: `${email} already has an account here. Emails must be unique within the tenant.` });

/*
  The OTHER email collision, and it is not the one the index catches.

  `user_tenant_email_uq` is per tenant, so `bob@example.com` may legally exist
  in tenant A and tenant B — the schema comment says as much, because one
  person may hold an account with two customers. What makes that legal shape
  dangerous TODAY is STI-305's `login()`: with no `tenantSlug` it requires the
  address to identify exactly ONE account across all tenants and REFUSES when
  it matches more than one. No client sends a `tenantSlug` yet (the login form
  has no tenant field), so creating the second account does not merely fail to
  help the new user — it silently locks the EXISTING one out of the tenant they
  were already working in, with no error raised anywhere near either admin and
  nothing in tenant B's logs to explain it.

  So `create` REFUSES rather than accepting-with-a-warning. The two options are
  not symmetric:

    - refuse: the damage lands on the admin who is asking for something, right
      now, with a message telling them exactly what to do about it.
    - warn: the damage lands on a user in a different tenant who never asked
      for anything, is never told, and whose only symptom is "my password
      stopped working". A warning shown to tenant A does not un-break tenant B.

  This is the one query in this file with NO `tenantId` predicate, deliberately,
  and it must stay an existence check: it selects a bare `id` that is never
  returned, never logged and never joined to anything. Nothing about the other
  tenant's row reaches the caller except the fact that the address is taken —
  which the refusal has to disclose to be actionable, and which is disclosed
  only to a `config.manage` holder. `login()` still fails CLOSED for anonymous
  callers, which is the surface STI-305's non-disclosure rule was written for.

  Revisit when sign-in identifies the tenant (a slug on the login form, or a
  subdomain). At that moment the ambiguity disappears and this refusal becomes
  unnecessary — it is a guard against a login that cannot choose, not a claim
  that one address may only ever exist once.

  Not race-proof, and cannot be without a global unique index the product does
  not want: two admins in two tenants creating the same address at the same
  instant both pass this check. That leaves the same lockout, so if this starts
  happening the fix is the tenant hint at login, not a bigger lock here.
*/
const takenElsewhere = (email: string) =>
  new TRPCError({
    code: "CONFLICT",
    message:
      `${email} is already the sign-in address of an account in another organisation. ` +
      "Sign-in does not yet ask which organisation you belong to, so an address used twice " +
      "locks BOTH accounts out. Use a different address for this person.",
  });

/* The shape every procedure returns. Named so that adding a column to `user`
   cannot quietly widen a response into the password hash. */
const publicColumns = {
  id: schema.user.id,
  email: schema.user.email,
  firstName: schema.user.firstName,
  lastName: schema.user.lastName,
  isActive: schema.user.isActive,
  employeeId: schema.user.employeeId,
  createdAt: schema.user.createdAt,
};

/* Confirms the row is this tenant's before any write touches it. `user_role`
   and `session` carry no tenant column of their own, so this lookup IS the
   isolation for the writes that follow. */
async function requireUser(db: Database, tid: string, id: string) {
  /* Columns, explicitly — `findFirst` with no projection would pull
     `passwordHash` into scope for every caller below. */
  const [u] = await db
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .where(and(eq(schema.user.id, id), eq(schema.user.tenantId, tid)))
    .limit(1);
  if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "No such account in this tenant" });
  return u;
}

export const userRouter = router({
  list: requirePermission("config.manage").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;

    const users = await ctx.db
      .select({ ...publicColumns, employeeName: schema.employee.name })
      .from(schema.user)
      /* The join carries its own tenant predicate: `employeeId` has no foreign
         key, so nothing else stops a stale link resolving to another tenant's
         person. */
      .leftJoin(
        schema.employee,
        and(eq(schema.employee.id, schema.user.employeeId), eq(schema.employee.tenantId, tid)),
      )
      .where(eq(schema.user.tenantId, tid))
      .orderBy(schema.user.email);

    if (!users.length) return [];

    /* `user_role` has no tenant column; the isolation is that these userIds
       are already restricted to this tenant's accounts. */
    const roles = await ctx.db
      .select({ userId: schema.userRole.userId, roleId: schema.role.id, roleName: schema.role.name })
      .from(schema.userRole)
      .innerJoin(schema.role, eq(schema.userRole.roleId, schema.role.id))
      .where(inArray(schema.userRole.userId, users.map((u) => u.id)));

    /* One grouped count for the page rather than a query per row, and keyed by
       EMPLOYEE — custody is held by the person, never by the login. Read-only:
       deactivating below does not touch these. */
    const held = await ctx.db
      .select({ employeeId: schema.asset.currentCustodianId, count: sql<number>`count(*)::int` })
      .from(schema.asset)
      .where(and(eq(schema.asset.tenantId, tid), isNotNull(schema.asset.currentCustodianId)))
      .groupBy(schema.asset.currentCustodianId);
    const heldBy = new Map(held.map((h) => [h.employeeId, h.count]));

    return users.map((u) => {
      /* One role per account: `resolveSession` reads `roleName` off the first
         permission row it gets, so a second role would make the displayed role
         arbitrary. `setRole` below enforces the same thing on the write side. */
      const r = roles.find((x) => x.userId === u.id) ?? null;
      return {
        ...u,
        roleId: r?.roleId ?? null,
        roleName: r?.roleName ?? null,
        heldToolCount: u.employeeId ? (heldBy.get(u.employeeId) ?? 0) : 0,
      };
    });
  }),

  /* The roles this tenant can hand out. `role.tenantId` is nullable — null
     means a system role — so both are offered. */
  roles: requirePermission("config.manage").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    return ctx.db
      .select({ id: schema.role.id, name: schema.role.name, description: schema.role.description })
      .from(schema.role)
      .where(or(eq(schema.role.tenantId, tid), isNull(schema.role.tenantId)))
      .orderBy(schema.role.name);
  }),

  create: requirePermission("config.manage")
    .input(
      z.object({
        email: z.string().email().max(200),
        firstName: z.string().min(1).max(80),
        lastName: z.string().min(1).max(80),
        /* Blank means "generate one and show it to me once" — the same
           credential path as `resetPassword`, so there is one answer to "how
           does somebody get their first password". */
        password: z.string().min(10).max(200).optional(),
        roleId: z.string().uuid().optional(),
        /* Optional and nullable, in both directions. An account with no
           employee is somebody who signs in but never holds a tool; an
           employee with no account is the normal case in the yard. */
        employeeId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      /* Trimmed, NOT lower-cased. `login()` compares the address verbatim, so
         folding case here would store an address the person cannot type back. */
      const email = input.email.trim();

      const [clash] = await ctx.db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(and(eq(schema.user.tenantId, tid), eq(schema.user.email, email)))
        .limit(1);
      if (clash) throw duplicateEmail(email);

      /* Deliberately UNSCOPED — see `takenElsewhere` above for why this one
         query has no tenant predicate and why the answer is a refusal. */
      const [elsewhere] = await ctx.db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, email))
        .limit(1);
      if (elsewhere) throw takenElsewhere(email);

      if (input.employeeId) {
        const [person] = await ctx.db
          .select({ id: schema.employee.id })
          .from(schema.employee)
          .where(and(eq(schema.employee.id, input.employeeId), eq(schema.employee.tenantId, tid)))
          .limit(1);
        if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "No such person in this tenant" });
      }

      if (input.roleId) await requireTenantRole(ctx.db, tid, input.roleId);

      const issued = input.password ? null : generatePassword();
      const passwordHash = await hashPassword(input.password ?? issued!);

      /* Both inserts or neither. The hash is computed above rather than inside,
         because bcrypt at cost 12 is a quarter-second and postgres.js pins a
         pool connection for the life of a transaction. An account that landed
         without its role is an account whose permissions nobody can explain
         from the audit trail — the same lesson as STI-115's orphaned asset. */
      const row = await ctx.db
        .transaction(async (tx) => {
          const [created] = await tx
            .insert(schema.user)
            .values({
              tenantId: tid,
              email,
              passwordHash,
              firstName: input.firstName.trim(),
              lastName: input.lastName.trim(),
              employeeId: input.employeeId ?? null,
              /* Set even when the admin typed the password: an admin-chosen
                 password is an admin-KNOWN password, so a second person holds
                 this account's credential until the owner replaces it. */
              mustChangePassword: true,
            })
            .returning(publicColumns);
          if (input.roleId) {
            await tx.insert(schema.userRole).values({ userId: created!.id, roleId: input.roleId });
          }
          return created!;
        })
        .catch((err) => {
          if (isDuplicateEmail(err)) throw duplicateEmail(email);
          throw err;
        });

      /* `details` names what was done, never the credential. */
      await logEvent(ctx, {
        category: "auth", action: "user.create", entityType: "user",
        entityId: row.id, entityLabel: email,
        details: { roleId: input.roleId ?? null, employeeId: input.employeeId ?? null, passwordGenerated: !!issued },
      });

      /* The only moment the plaintext exists outside the admin's keyboard. */
      return { user: row, temporaryPassword: issued };
    }),

  setRole: requirePermission("config.manage")
    .input(
      z.object({
        userId: z.string().uuid(),
        /* null clears every role — an account that can sign in and see nothing.
           That is a legitimate holding state, and it is not the same as
           deactivating, which is what stops them signing in at all. */
        roleId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const target = await requireUser(ctx.db, tid, input.userId);
      if (input.roleId) await requireTenantRole(ctx.db, tid, input.roleId);

      /* You may not take `config.manage` off yourself.

         This used to be unguarded, with the reasoning "another admin can put
         the role back" — which assumes another admin exists. On a tenant whose
         only administrator picks "No role" from a dropdown, nobody can put it
         back, nobody can create an account that could, and the only recovery is
         an UPDATE in psql. That is the same shape as the self-deactivate guard
         below and it deserves the same answer.

         The test is the permission, not the role: swapping owner for
         equipment_admin keeps `config.manage` and is allowed, because it locks
         nobody out. Clearing the role (`roleId: null`) never keeps it, which is
         the exact click this guard exists to stop. */
      if (input.userId === ctx.session.userId) {
        const keepsAdmin = input.roleId ? await roleGrantsConfigManage(ctx.db, input.roleId) : false;
        if (!keepsAdmin) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "You cannot remove your own administrator role. If you were the only administrator " +
              "there would be nobody left who could give it back. Ask another administrator to change it.",
          });
        }
      }

      /* Replace, do not add. `resolveSession` reads the role name off whichever
         permission row comes back first, so a second role makes the account's
         displayed role — and every screen that branches on it — arbitrary. */
      await ctx.db.transaction(async (tx) => {
        await tx.delete(schema.userRole).where(eq(schema.userRole.userId, input.userId));
        if (input.roleId) await tx.insert(schema.userRole).values({ userId: input.userId, roleId: input.roleId });
      });

      await logEvent(ctx, {
        category: "auth", action: "user.setRole", entityType: "user",
        entityId: input.userId, entityLabel: target.email,
        details: { roleId: input.roleId },
      });
      return { ok: true };
    }),

  setActive: requirePermission("config.manage")
    .input(z.object({ userId: z.string().uuid(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const target = await requireUser(ctx.db, tid, input.userId);

      /* Deactivating yourself is not recoverable from this screen: the very
         next request resolves no session, so nobody is left signed in who can
         undo it. `setRole` above now guards the same way for the same reason —
         the two are one hazard, "the last administrator locks the tenant out",
         reached by two different buttons. */
      if (!input.isActive && input.userId === ctx.session.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot deactivate your own account. Ask another administrator.",
        });
      }

      const [row] = await ctx.db
        .update(schema.user)
        .set({ isActive: input.isActive })
        .where(and(eq(schema.user.id, input.userId), eq(schema.user.tenantId, tid)))
        .returning(publicColumns);

      /* Nothing here touches `assignment`, `asset.current_*` or the ledger, and
         nothing should. An account going dark says nothing about where the
         tools are; moving them is departure reassignment (STI-306), and doing
         both from one button is how a tool ends up with no custodian and no
         event explaining it. */
      await logEvent(ctx, {
        category: "auth", action: input.isActive ? "user.reactivate" : "user.deactivate",
        entityType: "user", entityId: input.userId, entityLabel: target.email,
      });
      return row!;
    }),

  resetPassword: requirePermission("config.manage")
    .input(
      z.object({
        userId: z.string().uuid(),
        /* Blank generates one. See the note at the top of the file for why this
           is a temporary credential rather than a one-time link. */
        password: z.string().min(10).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const target = await requireUser(ctx.db, tid, input.userId);

      const issued = input.password ? null : generatePassword();
      const passwordHash = await hashPassword(input.password ?? issued!);

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(schema.user)
          .set({ passwordHash, mustChangePassword: true })
          .where(and(eq(schema.user.id, input.userId), eq(schema.user.tenantId, tid)));
        /* The revocation half. Without this the old bearer token keeps working
           and the reset has changed nothing for whoever already has it. */
        await tx
          .delete(schema.session)
          .where(and(eq(schema.session.userId, input.userId), eq(schema.session.tenantId, tid)));
      });

      /* Records that it happened, to whom, by whom — never the credential and
         never the hash. */
      await logEvent(ctx, {
        category: "auth", action: "user.resetPassword", entityType: "user",
        entityId: input.userId, entityLabel: target.email,
        details: { passwordGenerated: !!issued },
      });

      return { temporaryPassword: issued };
    }),

  /*
    The other half of `mustChangePassword`, and the only procedure here that is
    not an administrative one.

    `protectedProcedure`, NOT `requirePermission("config.manage")`. A person
    changing their own password is not performing an act of administration, and
    gating it on the admin permission would make the flag set by `create` and
    `resetPassword` impossible for an ordinary account to satisfy — every
    foreman would need the equipment desk to clear a flag whose entire purpose
    is to get the desk OUT of knowing their password. The scope check below is
    what stands in for a permission: the row written is always
    `ctx.session.userId`, which is never taken from the input, so there is no
    `userId` argument to tamper with and no way to reach another account.

    The current password is required. A session token is a bearer token; without
    this, anyone who got hold of one could set a password of their own choosing
    and convert a borrowed session into permanent ownership of the account.

    Sessions are deliberately NOT revoked here, unlike `resetPassword`.
    `ResolvedSession` carries no session id, so this resolver cannot tell its
    own token from any other and would have to delete all of them — signing the
    user out in the middle of the forced-change flow that sent them here.
    Revocation on suspected compromise is what `resetPassword` is for, and it
    does revoke.
  */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1).max(200),
        newPassword: z.string().min(10).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const userId = ctx.session.userId;

      /* The one read of `passwordHash` in this file. It is compared below and
         never returned — see the header comment. The tenant predicate is not
         decoration: `session.userId` is trusted, but the pair is what proves
         the row belongs to the tenant the session is acting in. */
      const [me] = await ctx.db
        .select({ id: schema.user.id, email: schema.user.email, passwordHash: schema.user.passwordHash })
        .from(schema.user)
        .where(and(eq(schema.user.id, userId), eq(schema.user.tenantId, tid)))
        .limit(1);
      if (!me) throw new TRPCError({ code: "NOT_FOUND", message: "No such account in this tenant" });

      if (!(await verifyPassword(input.currentPassword, me.passwordHash))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "That is not your current password." });
      }
      if (input.currentPassword === input.newPassword) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The new password must be different from the current one.",
        });
      }

      await ctx.db
        .update(schema.user)
        /* Clearing the flag is the point. A change that left it set would send
           the user back to the forced-change screen on every login forever. */
        .set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false })
        .where(and(eq(schema.user.id, userId), eq(schema.user.tenantId, tid)));

      /* Records that it happened and by whom — never the credential, never the
         hash, and no `details` that could carry either. */
      await logEvent(ctx, {
        category: "auth", action: "user.changePassword", entityType: "user",
        entityId: userId, entityLabel: me.email,
      });

      return { ok: true };
    }),
});

/* Does this role carry `config.manage`? Read after `requireTenantRole` has
   already proved the role is reachable from this tenant — `role_permission` has
   no tenant column of its own, so the ordering is the isolation. */
async function roleGrantsConfigManage(db: Database, roleId: string): Promise<boolean> {
  const [p] = await db
    .select({ name: schema.rolePermission.permissionName })
    .from(schema.rolePermission)
    .where(
      and(
        eq(schema.rolePermission.roleId, roleId),
        eq(schema.rolePermission.permissionName, "config.manage"),
      ),
    )
    .limit(1);
  return !!p;
}

/* Roles are tenant-scoped rows (or system rows with a null tenant). Without
   this check a uuid copied from another tenant's role list would hand its
   permissions to an account here. */
async function requireTenantRole(db: Database, tid: string, roleId: string) {
  const [r] = await db
    .select({ id: schema.role.id })
    .from(schema.role)
    .where(and(eq(schema.role.id, roleId), or(eq(schema.role.tenantId, tid), isNull(schema.role.tenantId))))
    .limit(1);
  if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "No such role in this tenant" });
}
