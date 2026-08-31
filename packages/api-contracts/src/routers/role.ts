import { z } from "zod";
import { and, count, eq, inArray, isNull, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@stinventory/db/schema";
import { PERMISSIONS, PERMISSION_GROUPS, ROLES, VIEW_SCOPES, type Permission } from "@stinventory/types";
import { requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

/*
  Editing what a role may do, from a screen.

  Why this exists at all. `docs/workings/PERMISSION_MATRIX.md` was written for
  Urban to sign off and never came back, so Phase 3 shipped on the defaults the
  document itself says apply in silence — six decisions in code that the
  customer had not seen, each cheap to reverse before release and a migration
  afterwards. That is a bad place to leave a product.

  A screen dissolves it. Urban looks at what the roles actually hold and
  changes what they disagree with, without a developer, a deploy or a
  migration. The proposed matrix stops being a decision made on their behalf
  and becomes a starting position.

  **The consequence, stated plainly, because it changes an invariant.**
  `packages/db/src/role-perms.ts` was the matrix — STI-308 asserted the
  database matched it exactly, in both directions. It cannot mean that any
  more: the moment somebody unticks a box the database is *supposed* to differ.
  `role-perms.ts` is now the FACTORY DEFAULT — what a fresh tenant is seeded
  with — and the test asserts that a freshly seeded tenant matches it, not that
  the live one does. See the note at the top of `rbac-matrix.test.ts`.

  What is NOT here, deliberately: creating new *permissions*. A permission is
  only real because `requirePermission("asset.read")` names it in code, so a
  permission somebody invents on a screen would gate nothing — it would be a
  checkbox that grants a feeling. Creating *roles* is genuinely useful and is
  here; inventing permission strings is not, and offering it would be worse
  than refusing it.

  Grants take effect on the caller's NEXT request: `resolveSession` reads
  `role_permission` fresh every time rather than caching it into the session,
  so nothing needs invalidating and a mistake is undone as fast as it was made.
*/

const permissionEnum = z.enum(PERMISSIONS as unknown as [Permission, ...Permission[]]);

/* A role name has to survive being compared against ROLES, which is a list of
   lowercase snake_case identifiers. Accepting "Site Manager" here would create
   a role no seed and no test could ever name. */
const roleNameSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers and underscores — like site_manager");

async function requireTenantRole(db: any, tid: string, roleId: string) {
  const [row] = await db
    .select({ id: schema.role.id, name: schema.role.name, tenantId: schema.role.tenantId })
    .from(schema.role)
    .where(and(eq(schema.role.id, roleId), or(eq(schema.role.tenantId, tid), isNull(schema.role.tenantId))))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No such role in this tenant" });
  /*
    A system role (`tenant_id IS NULL`) is shared by every tenant, so one
    tenant editing it would change another's. None exists today — the seed
    writes all thirteen against the tenant — but the column is nullable and the
    day one appears this must already refuse.
  */
  if (row.tenantId === null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "That is a system role shared by every tenant. Copy it to a role of your own instead.",
    });
  }
  return row;
}

export const roleRouter = router({
  /* The catalogue the editor renders: every permission, grouped, in words. */
  catalogue: requirePermission("config.manage").query(async () => ({
    groups: PERMISSION_GROUPS.map((g) => ({
      label: g.label,
      hint: "hint" in g ? g.hint : null,
      permissions: g.permissions.map(([key, label]) => ({ key, label })),
    })),
    /* The editor marks these specially: they are not "may do X" but "how much
       of X", and holding two is not additive — the widest wins. Somebody
       ticking all four expecting more access gets exactly `all`. */
    viewScopes: [...VIEW_SCOPES],
  })),

  list: requirePermission("config.manage").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;

    const roles = await ctx.db
      .select({
        id: schema.role.id, name: schema.role.name, description: schema.role.description,
        tenantId: schema.role.tenantId,
        needsLogin: schema.role.needsLogin,
        canHoldCustody: schema.role.canHoldCustody,
        usesFieldLayout: schema.role.usesFieldLayout,
      })
      .from(schema.role)
      .where(or(eq(schema.role.tenantId, tid), isNull(schema.role.tenantId)))
      .orderBy(schema.role.name);

    const roleIds = roles.map((r) => r.id);
    const grants = roleIds.length
      ? await ctx.db
          .select({ roleId: schema.rolePermission.roleId, name: schema.rolePermission.permissionName })
          .from(schema.rolePermission)
          .where(inArray(schema.rolePermission.roleId, roleIds))
      : [];

    /* How many accounts each role would affect. An administrator about to
       untick something needs to know whether that is one person or forty. */
    const holders = roleIds.length
      ? await ctx.db
          .select({ roleId: schema.userRole.roleId, c: count() })
          .from(schema.userRole)
          .innerJoin(schema.user, eq(schema.user.id, schema.userRole.userId))
          .where(and(eq(schema.user.tenantId, tid), inArray(schema.userRole.roleId, roleIds)))
          .groupBy(schema.userRole.roleId)
      : [];

    /* Accounts are not the only holders any more: a role sits on the PERSON,
       and most people in a yard have no account at all. A count of accounts
       alone would report `crew` as empty while forty labourers hold it. */
    const people = roleIds.length
      ? await ctx.db
          .select({ roleId: schema.employee.roleId, c: count() })
          .from(schema.employee)
          .where(and(eq(schema.employee.tenantId, tid), inArray(schema.employee.roleId, roleIds)))
          .groupBy(schema.employee.roleId)
      : [];
    const peopleByRole = new Map(people.map((p) => [p.roleId!, Number(p.c)]));

    /*
      A grant naming a permission the code no longer has is dropped here.

      `rental.read` and `rental.manage` were retired in 9907416 with no
      migration to delete the rows, and the live database still held them for
      owner, equipment_admin and warehouse. The editor renders its checkboxes
      from PERMISSION_GROUPS, so a name absent from the code got no checkbox —
      invisible, and impossible to untick — while still sitting in the draft
      this endpoint seeds. Save posted it straight back into
      `z.array(permissionEnum)`, which refused it, and the screen showed only
      "Could not save those permissions." — permanently, because the one
      control that could have cleared the row was the control the row jammed.

      0038 deletes the two rows this was written for. The filter is what makes
      the NEXT retired permission a no-op rather than a second deadlock, and it
      is self-healing: `setPermissions` replaces the whole set, so the first
      save after one appears writes it out of the database.

      Only this screen reads these. Authorization does not: `resolveSession`
      reads `role_permission` itself, where an unknown name is inert because
      nothing ever checks for it.
    */
    const known = new Set<string>(PERMISSIONS);
    const byRole = new Map<string, string[]>();
    for (const g of grants) {
      if (!known.has(g.name)) continue;
      byRole.set(g.roleId, [...(byRole.get(g.roleId) ?? []), g.name]);
    }
    const countByRole = new Map(holders.map((h) => [h.roleId, Number(h.c)]));

    /* Which roles came from the seed. A tenant role the seed does not know
       about is one somebody made here, and only those can be deleted. */
    const seeded = new Set<string>(ROLES);

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystemRole: r.tenantId === null,
      isBuiltIn: seeded.has(r.name),
      userCount: countByRole.get(r.id) ?? 0,
      permissions: (byRole.get(r.id) ?? []).sort(),
      needsLogin: r.needsLogin,
      canHoldCustody: r.canHoldCustody,
      usesFieldLayout: r.usesFieldLayout,
      peopleCount: peopleByRole.get(r.id) ?? 0,
    }));
  }),

  /*
    The role picker for the person form.

    Separate from `list` because `list` is gated on `config.manage` — the
    authority to CHANGE what a role may do. Choosing a person's role needs
    `employee.manage`, which is a different and much commoner authority, and
    reusing `list` would have meant either handing the permission editor to
    anyone who can add a person or refusing them the dropdown.

    Returns no permissions for the same reason: which boxes a role ticks is not
    this caller's business.
  */
  options: requirePermission("employee.manage").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    return ctx.db
      .select({
        id: schema.role.id,
        name: schema.role.name,
        description: schema.role.description,
        needsLogin: schema.role.needsLogin,
        canHoldCustody: schema.role.canHoldCustody,
      })
      .from(schema.role)
      .where(or(eq(schema.role.tenantId, tid), isNull(schema.role.tenantId)))
      .orderBy(schema.role.name);
  }),

  /*
    The three behaviour flags, which are NOT permissions and are edited apart
    from them on purpose.

    A permission answers "may they". These answer "what are they" — does this
    kind of person sign in at all, can a tool be booked to them, do they get the
    phone layout. Mixing them into the permission grid would put "is a foreman"
    next to "may approve a transfer" and invite reading the first as access
    control, which `needsLogin` explicitly is not: it changes what the register
    shows and nags about, and nothing in authentication reads it.
  */
  setFlags: requirePermission("config.manage")
    .input(
      z.object({
        roleId: z.string().uuid(),
        needsLogin: z.boolean(),
        canHoldCustody: z.boolean(),
        usesFieldLayout: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const role = await requireTenantRole(ctx.db, tid, input.roleId);
      await ctx.db
        .update(schema.role)
        .set({
          needsLogin: input.needsLogin,
          canHoldCustody: input.canHoldCustody,
          usesFieldLayout: input.usesFieldLayout,
        })
        .where(and(eq(schema.role.id, input.roleId), eq(schema.role.tenantId, tid)));
      await logEvent(ctx, {
        category: "auth", action: "role.setFlags", entityType: "role",
        entityId: input.roleId, entityLabel: role.name,
        details: { needsLogin: input.needsLogin, canHoldCustody: input.canHoldCustody, usesFieldLayout: input.usesFieldLayout },
      });
      return { ok: true };
    }),

  setPermissions: requirePermission("config.manage")
    .input(
      z.object({
        roleId: z.string().uuid(),
        permissions: z.array(permissionEnum).max(PERMISSIONS.length),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const role = await requireTenantRole(ctx.db, tid, input.roleId);
      const next = [...new Set(input.permissions)];

      /*
        You may not take `config.manage` off your own role.

        The same guard `user.setRole` carries, for the same reason and a worse
        failure: there is no second screen to undo it from. An administrator
        who removes it from the role they are signed in under loses this page,
        the users page and the settings page in one click, and the only way
        back is somebody with database access. `user.setRole`'s comment records
        that it used to be unguarded on the reasoning "another admin can put it
        back" — which is exactly the assumption that fails at 5pm on a Friday
        in a company with one administrator.

        Removing it from a role you are NOT in is allowed: that is an ordinary
        administrative act with somebody still able to reverse it.
      */
      if (!next.includes("config.manage")) {
        const [mine] = await ctx.db
          .select({ roleId: schema.userRole.roleId })
          .from(schema.userRole)
          .where(and(eq(schema.userRole.userId, ctx.session.userId), eq(schema.userRole.roleId, input.roleId)))
          .limit(1);
        if (mine) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "You cannot remove account administration from your own role — you would lose this screen and have no way back. Ask another administrator, or change your own role first.",
          });
        }
      }

      const before = await ctx.db
        .select({ name: schema.rolePermission.permissionName })
        .from(schema.rolePermission)
        .where(eq(schema.rolePermission.roleId, input.roleId));
      const had = new Set(before.map((b) => b.name));

      await ctx.db.transaction(async (tx) => {
        /* Replace rather than diff. The set is small, the write is one
           statement each way, and a diff would be three code paths to get
           wrong for no gain. Scoped by roleId, which `requireTenantRole`
           already proved belongs to this tenant. */
        await tx.delete(schema.rolePermission).where(eq(schema.rolePermission.roleId, input.roleId));
        if (next.length) {
          await tx
            .insert(schema.rolePermission)
            .values(next.map((p) => ({ roleId: input.roleId, permissionName: p })))
            .onConflictDoNothing();
        }
      });

      const added = next.filter((p) => !had.has(p));
      const removed = [...had].filter((p) => !next.includes(p as Permission));

      /* Audited with the delta, not the resulting set. "Who took approval away
         from the superintendents, and when" is the question somebody asks
         three weeks later, and a snapshot of the new state cannot answer it. */
      await logEvent(ctx, {
        category: "auth",
        action: "role.setPermissions",
        entityType: "role",
        entityId: input.roleId,
        entityLabel: role.name,
        details: { added, removed },
      });

      return { ok: true, added, removed };
    }),

  create: requirePermission("config.manage")
    .input(z.object({ name: roleNameSchema, description: z.string().max(200).optional(), copyFromRoleId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;

      const [clash] = await ctx.db
        .select({ id: schema.role.id })
        .from(schema.role)
        .where(and(eq(schema.role.name, input.name), or(eq(schema.role.tenantId, tid), isNull(schema.role.tenantId))))
        .limit(1);
      if (clash) {
        throw new TRPCError({ code: "CONFLICT", message: `There is already a role called "${input.name}".` });
      }

      const [created] = await ctx.db
        .insert(schema.role)
        .values({ tenantId: tid, name: input.name, description: input.description ?? null })
        .returning({ id: schema.role.id, name: schema.role.name });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create that role" });

      /*
        Copying an existing role is the realistic way a new one gets made — "a
        superintendent, but without approval" — and starting from blank means
        an administrator ticking thirty boxes from memory, which is how a role
        ends up with `config.manage` because it was next to something else.
      */
      if (input.copyFromRoleId) {
        const source = await requireTenantRole(ctx.db, tid, input.copyFromRoleId);
        const grants = await ctx.db
          .select({ name: schema.rolePermission.permissionName })
          .from(schema.rolePermission)
          .where(eq(schema.rolePermission.roleId, source.id));
        if (grants.length) {
          await ctx.db
            .insert(schema.rolePermission)
            .values(grants.map((g) => ({ roleId: created.id, permissionName: g.name })))
            .onConflictDoNothing();
        }
      }

      await logEvent(ctx, {
        category: "auth", action: "role.create", entityType: "role",
        entityId: created.id, entityLabel: created.name,
        details: { copiedFrom: input.copyFromRoleId ?? null },
      });
      return created;
    }),

  delete: requirePermission("config.manage")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const role = await requireTenantRole(ctx.db, tid, input.id);

      /*
        A built-in role is not deletable. Not because the row is special, but
        because `role-perms.ts` and the seed both name it: deleting `foreman`
        would make the next `SEED_RESET` recreate it and the RBAC test assert
        against something that is not there. Emptying its permissions is the
        supported way to retire one, and it leaves the accounts holding it
        signed in but unable to do anything — which is visible, unlike a role
        that silently vanished.
      */
      if ((ROLES as readonly string[]).includes(role.name)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `"${role.name}" is a built-in role and cannot be deleted. Untick its permissions instead if you want to retire it.`,
        });
      }

      const [held] = await ctx.db
        .select({ c: count() })
        .from(schema.userRole)
        .innerJoin(schema.user, eq(schema.user.id, schema.userRole.userId))
        .where(and(eq(schema.user.tenantId, tid), eq(schema.userRole.roleId, input.id)));
      if (Number(held?.c ?? 0) > 0) {
        /* Deleting cascades `user_role`, so the accounts would keep working
           and silently hold nothing — a permission change nobody made and
           nobody can see. Refuse and name the number. */
        throw new TRPCError({
          code: "CONFLICT",
          message: `${held!.c} account${Number(held!.c) === 1 ? " is" : "s are"} still on that role. Move them to another role first.`,
        });
      }

      await ctx.db.delete(schema.role).where(and(eq(schema.role.id, input.id), eq(schema.role.tenantId, tid)));
      await logEvent(ctx, {
        category: "auth", action: "role.delete", entityType: "role",
        entityId: input.id, entityLabel: role.name,
      });
      return { ok: true };
    }),
});
