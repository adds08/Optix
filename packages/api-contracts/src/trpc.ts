import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Database } from "@stinventory/db";
import type { ResolvedSession } from "@stinventory/auth";
import type { Permission } from "@stinventory/types";

export type Context = {
  db: Database;
  session: ResolvedSession | null;
  request: {
    method: string | null;
    path: string | null;
    ip: string | null;
    userAgent: string | null;
    source: "web" | "mobile" | "api" | "system";
  };
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const requirePermission = (permission: Permission) =>
  protectedProcedure.use(({ ctx, next }) => {
    if (!ctx.session.permissions.has(permission)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `missing permission: ${permission}` });
    }
    return next();
  });

export const middleware = t.middleware;
