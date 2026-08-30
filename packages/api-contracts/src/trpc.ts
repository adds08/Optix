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
  /* The `SMTP_*` env vars, already resolved into a `MailConfig | null` by
     apps/api. Same reasoning as `sessionSecret`: a plain value passed in, not
     the env module itself, so this package stays env-free. `mailConfigFor`
     (mail-config.ts) uses this as the fallback when a tenant has configured no
     SMTP of its own. */
  mailFallback: import("@stinventory/mail").MailConfig | null;
  /* `WEB_ORIGIN`, for building an invite/reset link the email can point at.
     Same reasoning as the above two — a value, not the env. */
  webOrigin: string;
  request: {
    method: string | null;
    path: string | null;
    ip: string | null;
    userAgent: string | null;
    source: "web" | "mobile" | "api" | "system";
  };
};

/*
  Procedure metadata — the mechanism behind STI-308's "every mutation carries a
  permission" test.

  `requirePermission` records WHICH permission it enforces on the procedure
  itself, so the router tree can be walked statically and asked the question.
  Without it the only way to test a bare `protectedProcedure` that mutates was
  to call it with valid input and see what happened, which means the test can
  only cover mutations somebody remembered to write a case for — and the one
  that matters is always the next one added.

  It is metadata about enforcement, never the enforcement itself: the `.use()`
  below is what actually refuses the call. Reading `meta.permission` to decide
  anything at runtime would make a comment load-bearing.
*/
export type Meta = { permission?: Permission };

const t = initTRPC.context<Context>().meta<Meta>().create({
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
    /*
      A zod refusal is not all one thing, and collapsing the two kinds is what
      made UI-75 unreportable.

      A `custom` issue comes from a `superRefine` somebody wrote, and its
      message is a sentence aimed at the person on the other end — "Say which
      department pays for this tool." is guidance by any measure. A built-in
      issue ("Invalid uuid") is library text about a wire shape, and belongs in
      the generic bucket with everything else machine-generated.

      Before this, both fell through as `shape.message` — the raw issue ARRAY —
      and the three entity forms render `err.message` directly. So a tool
      charged to a department with no department chosen answered a foreman with
      `[{"code":"custom","path":["owningDepartmentId"],"message":"Say which
      department pays for this tool."}]`, which reads as a crash, not as "you
      missed a field". The sentence the API had already written was sitting
      inside the noise the whole time.
    */
    const written =
      zod && zod.issues.length > 0 && zod.issues.every((i) => i.code === "custom")
        ? (zod.issues[0]?.message ?? null)
        : null;
    /* Machine-shaped zod text still gets a line a person can act on, rather
       than the array. `zodError` below keeps the detail for anything that
       wants to highlight individual fields. */
    const zodFallback = "Some of what was sent is not valid. Check the fields and try again.";
    /* `message` is redacted too, not just `userMessage`. Adding a safe field
       while leaving the unsafe one populated protects nobody: the clients that
       predate this formatter render `e.message` directly — custody/page.tsx:64
       and tools/[id]/page.tsx:54 both do — so a failed `vehicle.delete` showed
       a desk user `update or delete on table "vehicle" violates foreign key
       constraint "assignment_truck_fk"`. The original text still reaches the
       server logs; only the wire shape is redacted. */
    return {
      ...shape,
      message: internal
        ? "Something went wrong on our side. Try again, or ask the equipment desk."
        : (written ?? (zod ? zodFallback : shape.message)),
      data: {
        ...shape.data,
        userMessage: internal ? null : (written ?? (zod ? null : error.message)),
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
  protectedProcedure.meta({ permission }).use(({ ctx, next }) => {
    if (!ctx.session.permissions.has(permission)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `missing permission: ${permission}` });
    }
    return next();
  });

export const middleware = t.middleware;
