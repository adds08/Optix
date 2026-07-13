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

  ENGINE_BASE_URL: z.string().url().default("http://localhost:4600"),
  ENGINE_TIMEOUT_MS: z.coerce.number().default(15000),
  MOBILE_ORIGIN: z.string().default("http://localhost:8081"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("[@stinventory/env/server] invalid env:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid server env");
  }
  cached = Object.freeze(parsed.data);
  return cached;
}
