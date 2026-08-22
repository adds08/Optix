import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/*
  STI-119 — every write carries a tenant predicate, with no exceptions to
  reason about.

  CLAUDE.md non-negotiable 3: *"Every query carries `eq(table.tenantId, tid)`.
  There is no RLS. The WHERE clause **is** the isolation."* A rule with
  exceptions is not a rule you can check — and this one had nineteen. None was
  exploitable: each sat behind a check-then-act, a tenant-scoped `findFirst`
  that threw NOT_FOUND before the write. That is safe and it is not the same
  thing as checkable, because it means the reader has to trace back to a guard
  several lines up to know a `DELETE ... WHERE id = $1` is not a cross-tenant
  delete. The nineteen now carry the predicate too; this test is what stops a
  twentieth.

  It is a source scan, deliberately, and it needs no database. The alternative
  — a runtime test per procedure — can only cover procedures somebody
  remembered to write a case for, and the one that matters is always the next
  one added.

  It scans WRITES only (`update` / `delete`). Reads are narrowed by the STI-302
  ladder as well as by tenant and are covered by `rbac-matrix.test.ts`; a read
  that leaks is a different failure with a different test.
*/

const SRC = new URL("./", import.meta.url).pathname;

/* Tables carrying `tenant_id`. The four that do not — `tenant`, `permission`,
   `role_permission`, `user_role` — are absent on purpose and documented in
   `.claude/rules/database.md`: the first two are global, the last two are join
   tables whose tenant is carried by their parents. */
const TENANT_SCOPED = new Set([
  "asset", "assetModel", "assignment", "category", "channel", "department",
  "employee", "employeeProjectAssignment", "eventLog", "location", "manufacturer",
  "message", "notification", "project", "projectGroup", "projectGroupProject",
  "projectGroupUser", "projectTeamMember", "role", "session", "task",
  "tenantSettings", "transaction", "transfer", "user", "userPreferences",
  "vehicle", "warehouse",
]);

/*
  Writes that legitimately carry no tenant predicate. Each needs a reason, and
  the reason is the point — an entry here is a decision somebody wrote a
  sentence to justify.
*/
const EXEMPT: Record<string, string> = {
  // (none today — every write in this package carries one)
};

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("tenant isolation (STI-119)", () => {
  it("has no write to a tenant-scoped table without a tenant predicate", () => {
    const offenders: string[] = [];

    for (const file of tsFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      const re = /(?:await\s+)?(?:ctx\.)?(?:db|tx|trx)\s*\n?\s*\.\s*(update|delete)\s*\(\s*schema\.(\w+)/g;

      for (let m = re.exec(src); m; m = re.exec(src)) {
        const [, kind, table] = m;
        if (!TENANT_SCOPED.has(table!)) continue;

        /* The statement runs to the next `;`. Chained Drizzle builders put the
           whole thing in one statement, so this captures the `.where(...)`. */
        const end = src.indexOf(";", m.index);
        const stmt = src.slice(m.index, end === -1 ? m.index + 2000 : end);

        /* The common shape: the predicate is written inline. */
        if (stmt.includes("tenantId")) continue;

        /*
          The other real shape: `.where(activeLinks)` naming a predicate built
          further up. `custody.ts` does exactly this, and deliberately — it
          closes custody BY PREDICATE rather than by id, because duplicate
          active rows predate the STI-103 index and closing only the first
          would strand the rest. Re-inlining the predicate there to satisfy a
          test would make the code worse.

          So resolve the name: find `const <name> = ` in the same file and
          check that instead. One level, no recursion — a predicate built from
          another predicate is not a shape this codebase has, and chasing one
          would be inventing a problem.
        */
        const named = stmt.match(/\.where\(\s*([A-Za-z_$][\w$]*)\s*\)/)?.[1];
        if (named) {
          const decl = src.match(new RegExp(`const\\s+${named}\\s*=([\\s\\S]*?);`));
          if (decl?.[1]?.includes("tenantId")) continue;
        }

        /*
          Still a tripwire rather than proof. It cannot certify that a query is
          correctly scoped — only notice a write that never mentions the tenant
          at all, which is the shape all nineteen had.
        */

        const line = src.slice(0, m.index).split("\n").length;
        const rel = file.slice(file.indexOf("/src/") + 1);
        const key = `${rel}:${kind}(${table})`;
        if (key in EXEMPT) continue;
        offenders.push(`${rel}:${line} — ${kind}(${table})`);
      }
    }

    expect(
      offenders,
      `writes on tenant-scoped tables with no tenant predicate:\n  ${offenders.join("\n  ")}\n\n` +
        "Add eq(schema.<table>.tenantId, tid) to the WHERE, or add an entry to EXEMPT with a reason.",
    ).toEqual([]);
  });

  it("has no stale exemptions", () => {
    /* An exemption that is no longer needed is a place a real offender can
       hide behind a name that used to be legitimate. */
    const src = tsFiles(SRC).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const key of Object.keys(EXEMPT)) {
      const table = key.match(/\((\w+)\)$/)?.[1];
      expect(src, `exemption "${key}" names a table nothing writes any more`).toContain(`schema.${table}`);
    }
  });
});
