import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:stinventory@localhost:5433/stinventory",
  },
  strict: true,
  verbose: true,
} satisfies Config;
