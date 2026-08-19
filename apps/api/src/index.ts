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
import { createNotification, deliverPendingNotifications } from "./notifications.js";
import { reconcileProjections, type EventEnvelope } from "@stinventory/domain";
import { processQueuedMessages } from "./messaging-worker.js";
import { clearRateLimit, clientIp, rateLimit } from "./rate-limit.js";
import { isAllowedImage, MAX_PHOTO_BYTES, storageFor } from "./storage.js";
import { sweepRequests } from "./request-worker.js";
import * as schema from "@stinventory/db/schema";
import { and, eq } from "drizzle-orm";

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

/*
  Login is the one endpoint an unauthenticated stranger can hammer, and bcrypt
  makes each attempt expensive for us as well as for them — so an unbounded
  login route is both a credential-stuffing surface and a way to pin the CPU.

  Ten attempts per fifteen minutes per IP+email. Generous for a person who has
  forgotten which password they used, useless for a script.
*/
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;

app.post("/auth/login", async (c) => {
  /* `tenantSlug` is optional (STI-305). Omitted, the address must identify
     exactly one account across all tenants or the login is refused — the API
     never guesses which tenant was meant. Nothing sends it today; it is the
     hook a subdomain or a tenant field would use when a second tenant exists. */
  const body = await c.req.json<{ email: string; password: string; tenantSlug?: string }>();

  const key = `login:${clientIp(c.req.raw.headers)}:${(body.email ?? "").toLowerCase()}`;
  const limited = rateLimit(key, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!limited.allowed) {
    log.warn("[auth] login rate limited", { key });
    /* No detail about whether the account exists — a 429 that distinguished
       them would be an account enumeration oracle. */
    return c.json({ error: "too_many_attempts" }, 429, {
      "Retry-After": String(limited.retryAfter),
    });
  }

  const result = await login(db, body.email, body.password, body.tenantSlug);
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
  /* Succeeded, so the earlier failures were a person misremembering rather
     than an attack — give them their budget back. */
  clearRateLimit(key);
  return c.json({
    sessionId: result.sessionId,
    userId: result.userId,
    tenantId: result.tenantId,
    mustChangePassword: result.mustChangePassword,
  });
});

/*
  Tool photos.

  Not a tRPC procedure: this takes multipart form data, and tRPC's transport is
  JSON. Putting it on Hono keeps the binary path plain — the browser and the
  Expo app both post a normal FormData, and neither needs a serialiser that
  understands files.

  Authorisation is the same session and the same permission the register uses
  for any other edit, checked here rather than trusted from the client.
*/
app.post("/assets/:id/photo", async (c) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token ? await resolveSession(db, token) : null;
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  if (!session.permissions.has("asset.manage")) {
    return c.json({ error: "You do not have permission to change tools." }, 403);
  }

  const storage = storageFor(env);
  if (!storage) {
    return c.json(
      { error: "Photo storage is not configured on this server." },
      503,
    );
  }

  const assetId = c.req.param("id");
  const asset = await db.query.asset.findFirst({
    where: and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, session.tenantId)),
  });
  if (!asset) return c.json({ error: "No such tool." }, 404);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) return c.json({ error: "No image was attached." }, 400);

  if (!isAllowedImage(file.type)) {
    return c.json({ error: "Photos must be a JPEG, PNG or WebP image." }, 415);
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return c.json(
      { error: `That image is ${(file.size / 1048576).toFixed(1)}MB. The limit is 8MB.` },
      413,
    );
  }

  const body = Buffer.from(await file.arrayBuffer());
  const key = await storage.put({
    body,
    contentType: file.type,
    keyPrefix: `tools/${session.tenantId}`,
  });

  const previous = asset.photoKey;
  await db
    .update(schema.asset)
    .set({ photoKey: key, updatedAt: new Date() })
    .where(eq(schema.asset.id, assetId));

  /* Replacing a photo should not leave the old one paying rent. Done after the
     row is updated, so a failed delete cannot lose the new picture. */
  if (previous && previous !== key) await storage.remove(previous);

  return c.json({ ok: true, photoKey: key, photoUrl: storage.urlFor(key) });
});

app.delete("/assets/:id/photo", async (c) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token ? await resolveSession(db, token) : null;
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  if (!session.permissions.has("asset.manage")) {
    return c.json({ error: "You do not have permission to change tools." }, 403);
  }

  const assetId = c.req.param("id");
  const asset = await db.query.asset.findFirst({
    where: and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, session.tenantId)),
  });
  if (!asset) return c.json({ error: "No such tool." }, 404);

  await db
    .update(schema.asset)
    .set({ photoKey: null, updatedAt: new Date() })
    .where(eq(schema.asset.id, assetId));
  if (asset.photoKey) await storageFor(env)?.remove(asset.photoKey);
  return c.json({ ok: true });
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

/*
  `POST /ai/chat` used to live here. It carried a second, older copy of the
  intent logic that applied custody changes directly — no permission check, no
  confirmation step. A foreman with no `asset.manage` could write a tool off as
  lost through it, which the equivalent form refused. Nothing called it; both
  clients go through `messaging.send` → worker → `messaging.confirmAction`.

  Removed rather than patched: a second executor is the bug. Everything now
  routes through applyChatAction (packages/api-contracts/src/apply-action.ts),
  which charges permissions and never silently succeeds.
*/

/*
  The `/api/*` REST surface used to be mounted here (`rest-routes.ts`, 28 routes).
  Removed 2026-08-18 (STI-116) for the same reason `POST /ai/chat` above was: it
  was a second executor, and a second executor is the bug.

  It authenticated and then stopped — no permission checks at all, so a
  `warehouse` user refused by tRPC `employee.create` got a 200 from
  `POST /api/employees`. It mass-assigned (`{...body}` spread into the insert), so
  `POST /api/assets` could set `current_custodian_id` and `current_status`
  directly: custody state written with no ledger event and no chokepoint.
  `POST /api/assignment/:id/approve` flipped a status to `active` without closing
  the previous link or writing a `transaction` row. QA reached an unreportable
  no-evidence state with one authenticated call.

  Nothing called it: no reference in apps/web or apps/mobile, and the production
  Caddyfile routes only /trpc/*, /auth/*, /health, /assets/*, /media/* and
  /field/* — `/api/*` never reached this process in production at all.

  Its blanket `use("*")` bearer middleware also intercepted `/trpc/*`, which is why
  an unauthenticated tRPC call used to return a bare `{"error":"Unauthorized"}`
  instead of a tRPC UNAUTHORIZED envelope, and why every authenticated call
  resolved its session twice. Both are fixed by this removal — tRPC resolves its
  own session in `createContext` below and always did.
*/

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
        sessionSecret: env.SESSION_SECRET,
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

/* Notification delivery, every 60 seconds. This used to also detect overdue
   loans and rentals due; both went with the borrow and rental models on
   2026-08-09, so what is left is pushing what other code has already written. */
const SCAN_INTERVAL_MS = 60_000;
setInterval(async () => {
  try {
    await deliverPendingNotifications(db, env);
  } catch (err) {
    log.error("[notifications] delivery failed", { err: String(err) });
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

/*
  Request worker: retries messages stranded by an unreachable parser, and makes
  sure a field request waiting on the desk gets noticed.

  Slower than the message poller on purpose — nothing here is urgent to the
  second, and the retry only helps once the parser is actually back. It never
  approves anything; custody always waits for a person (ADR-4).
*/
const REQUEST_SWEEP_INTERVAL_MS = 60_000;
setInterval(async () => {
  try {
    const r = await sweepRequests(db);
    if (r.requeued || r.unstuck || r.announced || r.escalated) {
      log.info("[request-worker] sweep", r);
    }
  } catch (err) {
    log.error("[request-worker] sweep failed", { err: String(err) });
  }
}, REQUEST_SWEEP_INTERVAL_MS);
log.info(`[request-worker] sweeper started (every ${REQUEST_SWEEP_INTERVAL_MS / 1000}s)`);

/*
  Projection reconciliation (STI-106): replays the whole ledger per tenant and
  compares it against `asset.current_*`. Read-only by design — a divergence is a
  broken writer's only signal, and repairing it silently (asset.rebuild) is
  exactly how that signal gets destroyed. This sweep raises it instead.

  Six-hourly, not every 60s like the notification loop above: it scans every
  ledger row of every tenant, and a corruption that waits six hours to be seen
  is still caught in time to be diagnosed. One run at boot as well, because a
  first fire six hours after startup means a dev stack never runs it — and just
  after a deploy is precisely when a freshly shipped writer is most likely to
  have started corrupting.
*/
const RECONCILE_INTERVAL_MS = 6 * 60 * 60_000;
async function sweepProjectionDivergence() {
  const tenants = await db.select({ id: schema.tenant.id }).from(schema.tenant);
  for (const t of tenants) {
    const projected = (
      await db
        .select({
          assetId: schema.asset.id,
          assetNumber: schema.asset.assetNumber,
          tag: schema.asset.tag,
          status: schema.asset.currentStatus,
          custodianId: schema.asset.currentCustodianId,
          projectId: schema.asset.currentProjectId,
          locationId: schema.asset.currentLocationId,
        })
        .from(schema.asset)
        .where(eq(schema.asset.tenantId, t.id))
    ).map((a) => ({ ...a, label: a.tag ? `#${a.assetNumber} ${a.tag}` : `#${a.assetNumber}` }));
    const events = (await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.tenantId, t.id))) as unknown as EventEnvelope[];

    const divergences = reconcileProjections(projected, events);
    if (!divergences.length) {
      log.info(
        `[reconciliation] tenant ${t.id}: ${projected.length} assets checked against ${events.length} events, 0 divergences`,
      );
      continue;
    }

    /* The full detail goes to the log — folded vs projected, per asset. */
    log.error(`[reconciliation] tenant ${t.id}: ${divergences.length} divergent asset(s)`, {
      divergences: divergences.slice(0, 20),
    });

    /*
      And a human hears about it, not just the log. This is a desk alert through
      notifyDeskPending's mechanism — same recipient selection (active employees
      holding `tenantSettings.custodyApproverRole`, defaulting to
      `equipment_admin`), same notification table, same in-app bell — rather
      than a new report table, because the bell already reaches exactly the
      people who can act on custody being wrong, and a report row would need a
      migration and a screen to be seen at all. `custody_discrepancy` has been
      in NOTIFICATION_TYPES since the start with no writer; this is its meaning.
      No dedupe on purpose: at one notification per desk person per six hours, a
      divergence that persists SHOULD keep nagging until someone diagnoses it.
    */
    const [settings] = await db
      .select({ role: schema.tenantSettings.custodyApproverRole })
      .from(schema.tenantSettings)
      .where(eq(schema.tenantSettings.tenantId, t.id))
      .limit(1);
    const desk = await db
      .select({ id: schema.employee.id })
      .from(schema.employee)
      .where(
        and(
          eq(schema.employee.tenantId, t.id),
          eq(schema.employee.employmentStatus, "active"),
          eq(schema.employee.role, settings?.role ?? "equipment_admin"),
        ),
      );
    /*
      The body names which of two problems each tool has, because they need
      opposite responses (STI-110). Before the kinds were distinguished, a
      no-evidence divergence recurred here every six hours forever — rebuild
      skips it by design, so nothing the alert suggested could clear it, and an
      alert that keeps firing with no workable action is the shape people learn
      to dismiss. A dismissed reconciliation alert is worse than none.
    */
    const stale = divergences.filter((d) => d.kind === "stale_projection");
    const noEvidence = divergences.filter((d) => d.kind === "no_evidence");
    const clip = (n: number) => (n > 10 ? ` — and ${n - 10} more` : "");
    const parts: string[] = [];
    if (stale.length) {
      const detail = stale
        .slice(0, 10)
        .map(
          (d) =>
            `${d.label ?? d.assetId} (${d.fields.join(", ")}): ledger says ` +
            `${d.folded.status}/${d.folded.custodianId ?? "no custodian"}, register shows ` +
            `${d.projected.status}/${d.projected.custodianId ?? "no custodian"}`,
        )
        .join("; ");
      parts.push(
        `${stale.length} tool(s) where the register disagrees with the ledger: ${detail}${clip(stale.length)}. ` +
          `Something wrote custody without the ledger; do not repair until it is diagnosed — then Rebuild fixes these.`,
      );
    }
    if (noEvidence.length) {
      const detail = noEvidence
        .slice(0, 10)
        .map(
          (d) =>
            `${d.label ?? d.assetId} (register shows ` +
            `${d.projected.status}/${d.projected.custodianId ?? "no custodian"})`,
        )
        .join("; ");
      parts.push(
        `${noEvidence.length} tool(s) where the ledger has no evidence at all: ${detail}${clip(noEvidence.length)}. ` +
          `Rebuild will skip these — repairing on no evidence would blank a live row. ` +
          `To resolve one, record a real custody action for the tool through the app ` +
          `(an assignment, transfer or status change writes a complete snapshot that becomes its baseline); ` +
          `until then this alert repeats every six hours.`,
      );
    }
    for (const person of desk) {
      await createNotification(db, {
        tenantId: t.id,
        recipientEmployeeId: person.id,
        type: "custody_discrepancy",
        refType: "reconciliation",
        title: `Register out of step with the ledger: ${divergences.length} tool(s)`,
        body: parts.join(" "),
      });
    }
  }
}
sweepProjectionDivergence().catch((err) =>
  log.error("[reconciliation] boot sweep failed", { err: String(err) }),
);
setInterval(async () => {
  try {
    await sweepProjectionDivergence();
  } catch (err) {
    log.error("[reconciliation] sweep failed", { err: String(err) });
  }
}, RECONCILE_INTERVAL_MS);
log.info(`[reconciliation] scheduler started (every ${RECONCILE_INTERVAL_MS / 3_600_000}h)`);
