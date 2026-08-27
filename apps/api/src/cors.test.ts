import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { allowedOrigins, corsOptions } from "./cors.js";

/*
  STI-1601 — the API answered every origin.

  These tests mount the REAL `corsOptions` on a throwaway Hono app rather than
  asserting on the returned object, because the thing that matters is the header
  hono actually emits. `apps/api/src/index.ts` cannot be imported here: it opens
  a database connection and calls `serve()` at module load, which is why the
  options are a separate module at all.

  No database, so unlike `request-worker.test.ts` these always run.
*/
const WEB = "http://localhost:3100";
const MOBILE = "http://localhost:8081";
const ATTACKER = "https://evil.example.com";

function appWith(env: { WEB_ORIGIN: string; MOBILE_ORIGIN: string }) {
  const app = new Hono();
  app.use("*", cors(corsOptions(env)));
  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}

async function allowOriginFor(env: { WEB_ORIGIN: string; MOBILE_ORIGIN: string }, origin?: string) {
  const res = await appWith(env).request("/health", {
    headers: origin ? { Origin: origin } : {},
  });
  return res.headers.get("Access-Control-Allow-Origin");
}

describe("CORS allow-list (STI-1601)", () => {
  const env = { WEB_ORIGIN: WEB, MOBILE_ORIGIN: MOBILE };

  it("allows the configured web origin", async () => {
    expect(await allowOriginFor(env, WEB)).toBe(WEB);
  });

  it("allows the configured mobile origin, so Expo web keeps working", async () => {
    expect(await allowOriginFor(env, MOBILE)).toBe(MOBILE);
  });

  /*
    The whole point of the ticket. Before the fix this returned ATTACKER,
    because the origin function echoed whatever it was handed.
  */
  it("sends no Access-Control-Allow-Origin to an unlisted origin", async () => {
    expect(await allowOriginFor(env, ATTACKER)).toBeNull();
  });

  it("does not reflect an origin that merely starts with an allowed one", async () => {
    expect(await allowOriginFor(env, `${WEB}.evil.example.com`)).toBeNull();
  });

  /*
    Unchanged by the fix, and pinned because the ticket predicted otherwise:
    STI-1601 reads as though `?? env.WEB_ORIGIN` answered here. It never did.
    hono passes `""` for a missing Origin and `??` does not catch `""`, so the
    old callback returned `""` and hono omitted the header — measured against
    the old config, not deduced.
  */
  it("sends no Access-Control-Allow-Origin when no Origin header was sent", async () => {
    expect(await allowOriginFor(env)).toBeNull();
  });

  it("still refuses an unlisted origin on the preflight", async () => {
    const res = await appWith(env).request("/health", {
      method: "OPTIONS",
      headers: { Origin: ATTACKER, "Access-Control-Request-Method": "POST" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  /*
    Production sets `MOBILE_ORIGIN: ${MOBILE_ORIGIN:-}`. An explicit empty
    string satisfies `z.string()`, so it reaches this code — and `[""]
    .includes("")` is true, which would have matched every request that sends
    no Origin header at all.
  */
  it("drops an empty MOBILE_ORIGIN rather than matching the empty origin", async () => {
    const prod = { WEB_ORIGIN: "https://optix.example.com", MOBILE_ORIGIN: "" };
    expect(allowedOrigins(prod)).toEqual(["https://optix.example.com"]);
    expect(await allowOriginFor(prod)).toBeNull();
    expect(await allowOriginFor(prod, "https://optix.example.com")).toBe("https://optix.example.com");
  });
});
