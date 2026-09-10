import { and, eq } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, router } from "../trpc.js";

export const identityRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    const u = await ctx.db.query.user.findFirst({
      /* The tenant predicate is not decoration even though `session.userId` is
         trusted and unique: the PAIR is what proves the row belongs to the
         tenant this session is acting in, and CLAUDE.md non-negotiable 3 is a
         rule with no exceptions precisely so nobody has to work out which
         lookups are safe without one (STI-119). */
      where: and(eq(schema.user.id, ctx.session.userId), eq(schema.user.tenantId, ctx.session.tenantId)),
      columns: {
        id: true, email: true, firstName: true, lastName: true, tenantId: true, employeeId: true,
        /*
          STI-303 shipped `must_change_password` and reported it from
          `login()`, but nothing on any client read it — the flag was set on
          every created and reset account and then ignored, so "you must change
          your password" was true and unenforceable.

          It belongs HERE rather than only in the login response because a
          session outlives the login call: an administrator resetting a
          password mid-session must reach that user on their next page load,
          not only if they happen to sign in again.
        */
        mustChangePassword: true,
      },
    });
    if (!u) return null;

    /* Org identity — read alongside `me` rather than as its own query, the
       same reasoning as `feature.states`: every signed-in person needs to
       know which tenant they are in and what it is called, not just an
       administrator. `tenantSettings` may not have a row yet (nobody has
       ever visited Settings), so this is a plain select with a fallback
       rather than the `ensureRow` helper `settings.ts` uses when it is
       about to WRITE one. */
    const [t] = await ctx.db
      .select({ name: schema.tenant.name, slug: schema.tenant.slug })
      .from(schema.tenant)
      .where(eq(schema.tenant.id, ctx.session.tenantId))
      .limit(1);
    const [s] = await ctx.db
      .select({
        brandingName: schema.tenantSettings.brandingName,
        brandingLayoutMode: schema.tenantSettings.brandingLayoutMode,
      })
      .from(schema.tenantSettings)
      .where(eq(schema.tenantSettings.tenantId, ctx.session.tenantId))
      .limit(1);

    /*
      THE LAYOUT FLAG, and why it is queried here rather than inferred on the
      client.

      `tbl_entity_role.uses_field_layout` has existed, been editable at
      /admin/roles and been written by `role.update` for some time — and was
      never sent to any client. The web app instead kept its own
      `FIELD_ROLES = new Set(["foreman","superintendent","mechanic"])` and
      branched on the role NAME, so the administrator-facing toggle had no
      effect on the layout whatsoever: flipping it changed a column nothing
      read. A role a tenant creates could never get the field layout at all.

      Sent from here because a session outlives the login call — the same
      reasoning `mustChangePassword` above carries — and because this is the
      one query every screen already waits on.
    */
    const [r] = await ctx.db
      .select({ usesFieldLayout: schema.role.usesFieldLayout })
      .from(schema.userRole)
      .innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
      .where(eq(schema.userRole.userId, ctx.session.userId))
      .limit(1);

    return {
      ...u,
      role: ctx.session.roleName ?? null,
      /* Defaults to the DESK layout when a user somehow has no role row: the
         desk navigation is permission-filtered down to nothing for somebody
         with no grants, whereas defaulting to the field layout would show a
         three-item menu to an administrator and look broken. */
      usesFieldLayout: r?.usesFieldLayout ?? false,
      permissions: Array.from(ctx.session.permissions),
      tenant: {
        name: t?.name ?? null,
        slug: t?.slug ?? null,
        brandingName: s?.brandingName ?? null,
        brandingLayoutMode: s?.brandingLayoutMode ?? "icon_and_text",
      },
    };
  }),
});
