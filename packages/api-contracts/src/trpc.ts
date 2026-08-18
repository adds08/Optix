import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import superjson from "superjson";
import type { Database } from "@stinventory/db";
import type { ResolvedSession } from "@stinventory/auth";
import type { Permission } from "@stinventory/types";

export type Context = {
  db: Database;
  session: ResolvedSession | null;
  /* Needed to decrypt tenant-held secrets (see routers/settings.ts). Passed in
     rather than read here, so this package never loads env of its own. */
  sessionSecret: string;
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
  /*
    STI-204: whatever this returns in `data` is the type both clients infer on
    `TRPCClientError.data` — that inference is the whole mechanism for typed
    domain errors, so this is the one place the wire contract is written.

    `userMessage` is that contract: non-null exactly when the text was written
    for the person on the other end (a coded refusal like "A new tool needs a
    tag…"), null when the failure is internal and its message may name tables
    or invariants nobody outside should read. Clients render
    `data.userMessage ?? <generic fallback>` and never show internal text.
    `cause` is preserved on the server-side throw for the logs; tRPC never
    serialises it, which is correct — it is evidence, not guidance.
  */
  errorFormatter({ shape, error }) {
    const internal = error.code === "INTERNAL_SERVER_ERROR";
    /* A zod input failure is BAD_REQUEST, so it is not `internal` — but its
       message is the raw issue array, and the chat card renders `userMessage`
       verbatim. Left alone, a mistyped id showed the user
       `[{"validation":"uuid","code":"invalid_string",...}]` as guidance, which is
       the exact failure this formatter exists to prevent. Machine text gets the
       generic line; `zodError` carries the detail for anything that wants it. */
    const zod = error.cause instanceof ZodError ? error.cause : null;
    /* `message` is redacted too, not just `userMessage`. Adding a safe field
       while leaving the unsafe one populated protects nobody: the clients that
       predate this formatter render `e.message` directly — custody/page.tsx:64
       and tools/[id]/page.tsx:54 both do — so a failed `vehicle.delete` showed
       a desk user `update or delete on table "vehicle" violates foreign key
       constraint "assignment_truck_fk"`. The original text still reaches the
       server logs; only the wire shape is redacted. */
    return {
      ...shape,
      message: internal ? "Something went wrong on our side. Try again, or ask the equipment desk." : shape.message,
      data: {
        ...shape.data,
        userMessage: internal || zod ? null : error.message,
        zodError: zod ? zod.flatten() : null,
      },
    };
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
