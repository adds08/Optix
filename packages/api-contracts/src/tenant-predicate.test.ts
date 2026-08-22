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
/*
  `apps/api` is scanned too, and NOT as an afterthought — it is where the four
  defects STI-119 originally named actually lived (the photo upload and delete
  routes, the messaging worker's project lookup, the entity resolver's asset
  lookup). A first pass at this test scanned only this package, reported clean,
  and the ticket was marked done while all four were untouched. A sweep that
  cannot see half the writes is worse than no sweep, because it produces a
  green tick.
*/
const API_SRC = new URL("../../../apps/api/src/", import.meta.url).pathname;

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
  /*
    THE BACKGROUND WORKERS — the one real category, and the reason is the same
    for all three files.

    A worker has no session and therefore no tenant. It claims rows off a
    tenant-agnostic queue (`processingStatus = 'queued'`, ordered by age,
    across every tenant) and then updates the rows it just claimed, by id.
    There is no tenant to scope BY: adding `eq(message.tenantId, ???)` would
    have nothing to put in the second argument. A worker that filtered to one
    tenant would simply stop serving the others.

    What makes that safe is that the worker never takes an id from a user. It
    reads a batch, acts on that batch, and writes back to the same ids —
    `msgIds` in the claim, `msg.id` in the failure path, `t.id` in the
    escalation. Tenant isolation is preserved because the row carries its own
    `tenantId` into everything downstream (`processOne` reads `msg.tenantId`
    and scopes from there).

    This is exempted per FILE rather than per line because the reason is a
    property of the file — it is a worker — not of any one statement. If a
    worker ever grows a route or a procedure that takes a caller-supplied id,
    that reasoning stops applying and this entry must be narrowed.
  */
  "apps/api/src/messaging-worker.ts": "background worker: no session, claims from a tenant-agnostic queue and writes back the ids it claimed",
  "apps/api/src/request-worker.ts": "background worker: same — sweeps and escalates across every tenant by design",
  "apps/api/src/notifications.ts": "delivery worker: marks a notification it just read as delivered, by its own id",
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

    for (const file of [...tsFiles(SRC), ...tsFiles(API_SRC)]) {
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
        const rel = file.includes("/apps/api/")
          ? `apps/api/${file.slice(file.indexOf("/apps/api/src/") + "/apps/api/".length)}`
          : file.slice(file.indexOf("/src/") + 1);
        /* A file-level exemption (the workers) or a precise
           `path:kind(table)` one. File-level is deliberate for the workers —
           the reason is a property of the file, not of a statement. */
        if (rel in EXEMPT || `${rel}:${kind}(${table})` in EXEMPT) continue;
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
    const files = [...tsFiles(SRC), ...tsFiles(API_SRC)];
    const src = files.map((f) => readFileSync(f, "utf8")).join("\n");

    for (const key of Object.keys(EXEMPT)) {
      const table = key.match(/\((\w+)\)$/)?.[1];
      if (table) {
        expect(src, `exemption "${key}" names a table nothing writes any more`).toContain(`schema.${table}`);
        continue;
      }
      /* A file-level exemption must still name a file that exists — a renamed
         or deleted worker would otherwise leave a blanket pass behind it. */
      const base = key.slice(key.lastIndexOf("/") + 1);
      expect(files.some((f) => f.endsWith(base)), `exemption "${key}" names a file that no longer exists`).toBe(true);
    }
  });

  it("exempts only the workers, and every exemption carries a reason", () => {
    /* The list is where this test goes wrong: if triage starts dropping
       anything awkward into it to get green, it asserts history rather than
       policy. Every entry must be a background worker — nothing under
       `routers/` may ever appear here, because a router HAS a session. */
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `exemption "${key}" has no reason`).toBeGreaterThan(20);
      expect(key, `"${key}" is a router — a router has a session and can always scope`).not.toContain("/routers/");
    }
  });
});
