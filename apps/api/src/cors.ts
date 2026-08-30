import type { cors } from "hono/cors";
import type { ServerEnv } from "@stinventory/env";

type CorsOptions = NonNullable<Parameters<typeof cors>[0]>;

/*
  STI-1601.

  This was `origin: (origin) => origin ?? env.WEB_ORIGIN` beside
  `credentials: true`, which is not an allow-list at all: it echoes the caller's
  own `Origin` header straight back as `Access-Control-Allow-Origin`, so every
  origin on the internet was allowed.

  The `WEB_ORIGIN` in that expression never ran. STI-1601 describes it as the
  fallback for a request with no `Origin` header; measured, it was dead code.
  hono hands the callback `c.req.header("origin") || ""`, so a missing header
  arrives as an empty STRING, and `?? ` only catches null and undefined — the
  callback returned `""`, which hono treats as falsy and omits the header for.
  Worth knowing before writing the next `origin` callback: the absent case is
  `""`, never `undefined`.

  It was not an account takeover, and the reason is worth keeping because it is
  also the reason it had to be fixed anyway. The session is a bearer token in
  `localStorage`, so a browser will not attach it to a cross-origin request: an
  attacker's page could reach the API and had nothing to reach it *with*.
  `credentials: true` next to a reflected origin is precisely the pair that
  becomes full account takeover the moment the session moves to a cookie — and
  STI-1602 proposes moving it to a cookie. Fixing this first is what makes that
  story safe to start.

  An ARRAY rather than a function, deliberately: hono resolves an array as
  `list.includes(origin) ? origin : null`, and a `null` omits the header
  entirely. That is the acceptance criterion — an unlisted origin gets no
  `Access-Control-Allow-Origin` at all, rather than one naming somebody else
  that the browser then has to reject.
*/
export function allowedOrigins(env: Pick<ServerEnv, "WEB_ORIGIN" | "MOBILE_ORIGIN">): string[] {
  /*
    `MOBILE_ORIGIN` had been declared in `packages/env`, `.env.example` and
    `docker-compose.prod.yml` since the mobile client existed and was read by
    nothing. This is its first reader, and it is what stops the fix breaking
    Expo *web*, which is served from :8081 and is a genuine cross-origin caller.
    The Expo native build sends no `Origin` header and is unaffected either way.

    Empty is filtered, not passed through: production sets `MOBILE_ORIGIN:
    ${MOBILE_ORIGIN:-}`, and an explicit empty string satisfies `z.string()` and
    survives the schema default. `[""].includes("")` is true, so leaving it in
    would match every request that sends no `Origin` header.
  */
  return [env.WEB_ORIGIN, env.MOBILE_ORIGIN].filter((origin) => origin.length > 0);
}

export function corsOptions(env: Pick<ServerEnv, "WEB_ORIGIN" | "MOBILE_ORIGIN">): CorsOptions {
  return {
    origin: allowedOrigins(env),
    credentials: true,
    allowHeaders: ["Authorization", "Content-Type"],
  };
}
