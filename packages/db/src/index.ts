import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export type Database = ReturnType<typeof createDb>;

/*
  The handle every custody write must be given (see
  packages/api-contracts/src/custody.ts). Extracted from drizzle's own
  `transaction` callback rather than hand-written so it tracks the driver.
  `Database` is deliberately NOT assignable to it — PgTransaction adds
  `rollback()` — which turns "custody writes happen inside a transaction"
  from a convention into a compile error. The old `db: any` signatures are
  exactly how a raw handle got passed and left half-applied custody moves
  behind (STI-102).
*/
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 });
  return drizzle(client, { schema });
}

export { schema };
/* The permission matrix in code — read by the seed and by the RBAC matrix
   test (STI-308), which is why it is exported from the package root rather
   than reached into by path. */
export { ROLE_PERMS, PM_PERMS } from "./role-perms";
export * from "./schema/index";
