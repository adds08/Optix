import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://postgres:optix@localhost:5433/optix";

const client = postgres(url, { max: 1 });
const db = drizzle(client);

async function main() {
  console.log("[optix/db] running migrations against", url.replace(/:[^@]+@/, ":***@"));
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[optix/db] migrations complete");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
