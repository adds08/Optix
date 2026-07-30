import { z } from "zod";

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4100),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  WEB_ORIGIN: z.string().url().default("http://localhost:3100"),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),

  LLM_API_KEY: z.string().default(""),
  LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  LLM_TIMEOUT_MS: z.coerce.number().default(15000),
  MOBILE_ORIGIN: z.string().default("http://localhost:8081"),

  /*
    Photo storage, spoken to over the S3 API.

    Deliberately not "MinIO settings". MinIO, DigitalOcean Spaces, AWS S3 and
    Cloudflare R2 all answer the same protocol, so which one is behind this is a
    deployment choice rather than a code one — moving from the container on the
    droplet to a managed bucket is four environment variables, no rebuild.

    Unset means photos are simply off: the upload route refuses and the register
    shows placeholders. That is the correct behaviour for a stack nobody has
    given a bucket to, rather than an error at boot.
  */
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("stinventory"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  /* Public base for reading objects back. Separate from the endpoint because a
     MinIO container is reached internally as http://minio:9000 and publicly
     through Caddy at /media — the URL a browser needs is not the one the API
     writes to. */
  S3_PUBLIC_URL: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

/*
  Values that are fine locally and must never reach production.

  A guessable session secret is the same as having no authentication: anyone
  who reads this repository can mint a session. `.env.example` ships one so the
  demo works out of the box, and an example value copied forward is exactly how
  it ends up on a server.
*/
const FORBIDDEN_IN_PRODUCTION = [
  "stinventory-dev-secret-please-change-to-32-chars-minimum",
  "changeme",
  "secret",
];

export function assertProductionSafe(env: ServerEnv): void {
  if (env.NODE_ENV !== "production") return;

  const problems: string[] = [];

  const secret = env.SESSION_SECRET.toLowerCase();
  if (FORBIDDEN_IN_PRODUCTION.some((bad) => secret.includes(bad.toLowerCase()))) {
    problems.push("SESSION_SECRET is a known example value — generate a fresh one");
  }
  /* Length is already enforced at 32 by the schema, but a repeated character
     satisfies that while carrying almost no entropy. */
  if (new Set(env.SESSION_SECRET).size < 12) {
    problems.push("SESSION_SECRET has too little variety to be random");
  }
  if (env.WEB_ORIGIN.startsWith("http://") && !env.WEB_ORIGIN.includes("localhost")) {
    problems.push("WEB_ORIGIN is plain http — session tokens would cross the network in clear");
  }

  if (problems.length) {
    throw new Error(
      `Refusing to start in production:\n  - ${problems.join("\n  - ")}\n` +
        "These are configuration errors, not warnings.",
    );
  }
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("[@stinventory/env/server] invalid env:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid server env");
  }
  /* Checked before caching, so a misconfigured production process fails on
     first call rather than starting and serving with a known-bad secret. */
  assertProductionSafe(parsed.data);
  cached = Object.freeze(parsed.data);
  return cached;
}
