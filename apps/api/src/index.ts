import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "@stinventory/api-contracts";
import { createDb } from "@stinventory/db";
import { resolveSession, login, logout } from "@stinventory/auth";
import { serverEnv } from "@stinventory/env";
import { createLogger } from "@stinventory/logger";
import { detectOverdueLoans, deliverPendingNotifications } from "./notifications.js";
import { handleAiChat } from "./ai.js";
import { processQueuedMessages } from "./messaging-worker.js";
import { mountRestRoutes } from "./rest-routes.js";
import * as schema from "@stinventory/db/schema";
import { eq } from "drizzle-orm";

function detectSource(userAgent: string | undefined): "web" | "mobile" | "api" {
  if (!userAgent) return "api";
  if (/expo|okhttp|react-native/i.test(userAgent)) return "mobile";
  if (/mozilla|chrome|safari|firefox|edg/i.test(userAgent)) return "web";
  return "api";
}

const env = serverEnv();
const log = createLogger("api");
const db = createDb(env.DATABASE_URL);

const app = new Hono();
app.use("*", honoLogger());
app.use(
  "*",
  cors({
    origin: (origin) => origin ?? env.WEB_ORIGIN,
    credentials: true,
    allowHeaders: ["Authorization", "Content-Type"],
  }),
);

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.post("/auth/login", async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  const result = await login(db, body.email, body.password);
  if (!result.ok) {
    await db.insert(schema.eventLog).values({
      tenantId: null,
      actorUserId: null,
      category: "auth",
      action: "login",
      result: "failure",
      errorMessage: result.reason,
      source: detectSource(c.req.header("user-agent") ?? undefined),
      httpMethod: "POST",
      httpPath: "/auth/login",
      details: { email: body.email },
    }).catch((err) => log.error("[audit] failed-login insert", { err: String(err) }));
    return c.json({ error: result.reason }, 401);
  }
  const u = await db.query.user.findFirst({ where: eq(schema.user.id, result.userId) });
  await db.insert(schema.eventLog).values({
    tenantId: result.tenantId,
    actorUserId: result.userId,
    actorLabel: u ? `${u.firstName} ${u.lastName} (${u.email})` : body.email,
    category: "auth",
    action: "login",
    result: "success",
    source: detectSource(c.req.header("user-agent") ?? undefined),
    httpMethod: "POST",
    httpPath: "/auth/login",
  }).catch((err) => log.error("[audit] login insert", { err: String(err) }));
  return c.json({ sessionId: result.sessionId, userId: result.userId, tenantId: result.tenantId });
});

app.post("/auth/logout", async (c) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (token) {
    const sess = await resolveSession(db, token);
    await logout(db, token);
    if (sess) {
      await db.insert(schema.eventLog).values({
        tenantId: sess.tenantId,
        actorUserId: sess.userId,
        actorRole: sess.roleName,
        actorLabel: sess.actorLabel,
        category: "auth",
        action: "logout",
        result: "success",
        source: detectSource(c.req.header("user-agent") ?? undefined),
        httpMethod: "POST",
        httpPath: "/auth/logout",
      }).catch((err) => log.error("[audit] logout insert", { err: String(err) }));
    }
  }
  return c.json({ ok: true });
});

app.post("/ai/chat", async (c) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const session = await resolveSession(db, token);
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const { message } = await c.req.json<{ message: string }>();
  if (!message || !message.trim()) return c.json({ result: "Say something!" });
  const result = await handleAiChat(db, session, message.trim());

  // Bridge: create a message record so the Kanban sees it
  if (result.intent) {
    const channel = await db.query.channel.findFirst({
      where: eq(schema.channel.tenantId, session.tenantId),
    });
    if (channel) {
      const status = !result.ok ? "error"
        : result.intent.status === "pending_verification" ? "action_proposed"
        : "action_executed";
      await db.insert(schema.message).values({
        tenantId: session.tenantId,
        channelId: channel.id,
        authorUserId: session.userId,
        body: message.trim(),
        processingStatus: status,
        intentType: result.intent.type,
        proposedAction: {
          type: result.intent.type,
          department: result.intent.department,
        },
      });
    }
  }

  return c.json(result);
});

mountRestRoutes(app, db);

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: async (_opts, c) => {
      const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
      const session = await resolveSession(db, token);
      const ua = c.req.header("user-agent") ?? null;
      const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null;
      const url = new URL(c.req.url);
      return {
        db,
        session,
        request: {
          method: c.req.method,
          path: url.pathname,
          ip,
          userAgent: ua,
          source: detectSource(ua ?? undefined),
        },
      };
    },
  }),
);

const port = env.PORT;
serve({ fetch: app.fetch, port }, (info) => {
  log.info(`apps/api listening on :${info.port}`);
});

// Notification scheduler: runs every 60 seconds. Detection + delivery.
const SCAN_INTERVAL_MS = 60_000;
setInterval(async () => {
  try {
    const n = await detectOverdueLoans(db);
    if (n > 0) log.info(`[notifications] detected ${n} new overdue loans`);
    await deliverPendingNotifications(db, env);
  } catch (err) {
    log.error("[notifications] scan failed", { err: String(err) });
  }
}, SCAN_INTERVAL_MS);
log.info(`[notifications] scheduler started (every ${SCAN_INTERVAL_MS / 1000}s)`);

// Messaging worker: polls queued messages every 3-5 seconds.
const MSG_POLL_INTERVAL_MS = 4_000;
setInterval(async () => {
  try {
    const n = await processQueuedMessages(db, env);
    if (n > 0) log.info(`[messaging-worker] processed ${n} queued messages`);
  } catch (err) {
    log.error("[messaging-worker] poll failed", { err: String(err) });
  }
}, MSG_POLL_INTERVAL_MS);
log.info(`[messaging-worker] poller started (every ${MSG_POLL_INTERVAL_MS / 1000}s)`);
