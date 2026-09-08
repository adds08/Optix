import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import {
  adaptBambooPage,
  BAMBOO_OPTIONAL_FIELDS,
  type AdaptedBambooPerson,
  type BambooEmployeeRecord,
} from "@stinventory/domain";

/*
  The BambooHR people sync: fetch, diff, then either report or write.

  READ-ONLY AGAINST BAMBOOHR, AND THAT IS ENFORCED HERE RATHER THAN TRUSTED.
  `bambooGet` is the only function in this file that touches the network, it
  hardcodes `method: "GET"`, and it takes no verb parameter — so there is no
  argument anybody can pass to make it write. The client's instruction
  (2026-09-06) is that this integration only ever reads from their PRODUCTION
  HR system, and a BambooHR API key is not itself read-only: it would happily
  accept a POST. The restraint has to live in our code.

  `bamboo-sync.test.ts` asserts the method, so a future change that adds a verb
  fails a test rather than shipping.

  Everything this writes goes into our own Postgres.
*/

/*
  The DOCUMENTED base URL: `https://{companyDomain}.bamboohr.com/api/v1/`.

  This was `https://api.bamboohr.com` with an `/api/gateway.php/{domain}/v1`
  path until 2026-09-07 — the legacy gateway form. That form WORKS (it returned
  1851 real records) but appears nowhere in BambooHR's current documentation,
  which makes it one deprecation away from a silent outage. Corrected after the
  user pointed out the docs give the subdomain form; the path was read off the
  reference and the host was filled in from memory, which is the half that was
  wrong.

  The company domain now lands in the HOSTNAME rather than the path, so it is
  validated below rather than escaped — you cannot percent-encode your way out
  of a hostname, and a config value spliced into one unchecked is how a request
  ends up somewhere else entirely.
*/
function bambooBaseUrl(companyDomain: string): string {
  /* Letters, digits and hyphens only, and not at either end — the DNS label
     rules. Anything else is a misconfiguration, and refusing loudly beats
     resolving a host nobody intended. */
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(companyDomain)) {
    throw new Error(
      "BAMBOOHR_COMPANY_DOMAIN is not a valid subdomain — expected the bit before .bamboohr.com",
    );
  }
  return `https://${companyDomain}.bamboohr.com/api/v1`;
}

/** BambooHR caps `page[limit]` at 2500; 250 is its default. 500 keeps the
    number of round trips low for Urban's roster without asking for a page big
    enough to time out on a slow link. */
const PAGE_LIMIT = 500;

/** A whole sync must not hang a worker slot forever on a stalled connection. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Pages are followed until the cursor runs out; this stops a malformed
    `nextCursor` that points at itself from looping until the process dies. */
const MAX_PAGES = 200;

export type BambooCredentials = {
  companyDomain: string;
  apiKey: string;
};

/** Reads credentials without importing `serverEnv()`, so a caller can pass
    per-tenant values later without this file changing. Empty disables the
    sync — a tenant that has not bought BambooHR is normal, not broken. */
export function bambooCredentialsFrom(env: {
  BAMBOOHR_COMPANY_DOMAIN?: string | undefined;
  BAMBOOHR_API_KEY?: string | undefined;
}): BambooCredentials | null {
  const companyDomain = env.BAMBOOHR_COMPANY_DOMAIN?.trim();
  const apiKey = env.BAMBOOHR_API_KEY?.trim();
  if (!companyDomain || !apiKey) return null;
  return { companyDomain, apiKey };
}

/*
  One GET. The ONLY network call in the sync.

  Basic auth with the API key as the USERNAME and the literal `x` as the
  password — BambooHR's own scheme, which is why there is no password setting
  anywhere in our config.

  Never logs the key, the Authorization header, or the response body. A failed
  sync writes `errorNote`, and an error string that carried a credential would
  put it in a database column and then on a screen.
*/
async function bambooGet(
  creds: BambooCredentials,
  path: string,
  query: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${bambooBaseUrl(creds.companyDomain)}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const auth = Buffer.from(`${creds.apiKey}:x`).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      /* Hardcoded, and there is deliberately no parameter for it. */
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      /* Status and a short hint only. The body can echo request content, and
         this string is stored and displayed. */
      const hint =
        res.status === 401 || res.status === 403
          ? " — check the API key and that it has employee read access"
          : res.status === 404
            ? " — check the company domain"
            : "";
      throw new Error(`BambooHR returned ${res.status}${hint}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/*
  Is `jobTitle` a list BambooHR manages, or free text somebody types?

  This exists because the answer changes what the title-to-tier mapping has to
  be, and nothing in this codebase had ever asked:

  - **A managed list** means the set of titles is finite and known. Mapping each
    one to a team-role tier is a table you fill in once.
  - **Free text** means new spellings arrive forever — Urban's own spreadsheet
    carries "Forman", "field Engineer" and "Saftey Manager" — so the mapping
    needs a permanent unmapped queue rather than a one-off setup.

  Designing for the wrong one is expensive in opposite directions, hence a read
  rather than a guess. `/meta/lists` returns only the fields that ARE lists, so
  `managed: false` (no entry for job title) is the free-text answer rather than
  an error.

  Goes through `get` like every other call here — see this file's header. There
  is deliberately no second `fetch` in this module, and
  `bamboo-sync.test.ts` fails if one appears.
*/
export type BambooJobTitleOptions = {
  /** True when BambooHR reports job title as a list field it manages. */
  managed: boolean;
  /** Option names, archived ones excluded, sorted. Empty when not managed. */
  options: string[];
  /** Archived options, kept separate: still attached to old records. */
  archived: string[];
};

export async function fetchBambooJobTitleOptions(
  creds: BambooCredentials,
  get: typeof bambooGet = bambooGet,
): Promise<BambooJobTitleOptions> {
  const body = await get(creds, "/meta/lists", {});
  const lists = Array.isArray(body) ? body : [];

  /* Matched on alias first, then on the display name. BambooHR's alias for
     this field is `jobTitle`; the name is tenant-editable, so it is the
     fallback rather than the test. */
  const list = lists.find((l: unknown) => {
    const row = l as { alias?: unknown; name?: unknown };
    const alias = typeof row.alias === "string" ? row.alias.toLowerCase() : "";
    const name = typeof row.name === "string" ? row.name.toLowerCase().replace(/\s+/g, "") : "";
    return alias === "jobtitle" || name === "jobtitle";
  }) as { options?: unknown } | undefined;

  if (!list) return { managed: false, options: [], archived: [] };

  const options: string[] = [];
  const archived: string[] = [];
  for (const raw of Array.isArray(list.options) ? list.options : []) {
    const opt = raw as { name?: unknown; archived?: unknown };
    if (typeof opt.name !== "string" || opt.name.trim() === "") continue;
    /* BambooHR sends "yes"/"no" strings here, not booleans. */
    (String(opt.archived).toLowerCase() === "yes" ? archived : options).push(opt.name.trim());
  }
  options.sort((a, b) => a.localeCompare(b));
  archived.sort((a, b) => a.localeCompare(b));
  return { managed: true, options, archived };
}

/*
  Follow `meta.page.nextCursor` to the end.

  Paginated rather than assuming one page, because `list-employees` is
  cursor-paginated and a roster that outgrew the first page would otherwise
  sync a prefix of the company and report success — the failure mode being that
  everybody past the cut looks like a leaver.
*/
export async function fetchAllBambooEmployees(
  creds: BambooCredentials,
  get: typeof bambooGet = bambooGet,
): Promise<{ records: BambooEmployeeRecord[]; reportedTotal: number | null; complete: boolean }> {
  const out: BambooEmployeeRecord[] = [];
  let cursor: string | undefined;
  let reportedTotal: number | null = null;
  const seen = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const query: Record<string, string> = {
      fields: BAMBOO_OPTIONAL_FIELDS.join(","),
      "page[limit]": String(PAGE_LIMIT),
    };
    if (cursor) query["page[after]"] = cursor;

    const body = (await get(creds, "/employees", query)) as {
      data?: unknown;
      meta?: { total?: unknown; page?: { nextCursor?: unknown } };
    };
    const rows = Array.isArray(body?.data) ? (body.data as BambooEmployeeRecord[]) : [];
    out.push(...rows);

    /* `meta.total` is BambooHR's own count of everything matching the request,
       not just this page. Captured from the FIRST page and then compared
       against what we actually collected — the published spec is explicit that
       a caller must reconcile the two before trusting any figure, because a
       short read is indistinguishable from a small company. Without this a
       truncated pagination loop syncs a prefix of the roster and reports
       success, and every employee past the cut looks like a leaver. */
    if (reportedTotal === null && typeof body?.meta?.total === "number") {
      reportedTotal = body.meta.total;
    }

    const next = body?.meta?.page?.nextCursor;
    if (typeof next !== "string" || next.length === 0) break;
    /* A cursor we have already followed means the far end is repeating itself;
       stop rather than spin. */
    if (seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }

  /* Complete when BambooHR did not tell us a total (nothing to check against)
     or when what we collected matches it. An INCOMPLETE read is reported, never
     silently applied. */
  const complete = reportedTotal === null || out.length >= reportedTotal;
  return { records: out, reportedTotal, complete };
}

/* ------------------------------------------------------------------ */
/* The diff                                                            */
/* ------------------------------------------------------------------ */

export type FieldChange = {
  field: string;
  from: string | null;
  to: string;
};

export type PersonPlan = {
  externalId: string;
  /* The name we can show a human. Best effort: Bamboo's, else the matched
     employee's, else the id. */
  label: string;
  action: "create" | "update" | "skip";
  employeeId?: string;
  /* Applied without asking. */
  changes: FieldChange[];
  /* Shown and NOT applied — `code` and `name` on an existing person. */
  needsConfirming: FieldChange[];
  /* BambooHR says inactive. Reported, never acted on. */
  flaggedInactive: boolean;
  /* Which fields BambooHR withheld from our key. */
  withheld: string[];
};

export type SyncPlan = {
  people: PersonPlan[];
  refused: { reason: string }[];
  counts: {
    created: number;
    updated: number;
    skipped: number;
    refused: number;
    flagged: number;
  };
};

/*
  Build the plan. PURE with respect to the database — it takes rows in and
  returns a plan out, writing nothing, so `preview` and `apply` are guaranteed
  to agree about what would happen. A preview computed by a different code path
  from the apply is a preview that can lie.
*/
export function buildSyncPlan(
  incoming: AdaptedBambooPerson[],
  refused: { reason: string }[],
  existing: {
    byExternalId: Map<string, { id: string; name: string; code: string | null; email: string | null }>;
    byName: Map<string, { id: string; name: string; code: string | null; email: string | null }>;
    ambiguousNames: Set<string>;
  },
): SyncPlan {
  const people: PersonPlan[] = [];

  for (const p of incoming) {
    /*
      Match on the BambooHR id first — that is the whole reason
      `employee_external_ref` exists, and it is stable across a rename.

      Fall back to NAME only when no ref exists yet, which is every person on
      the first ever run. That fallback is the dangerous one: Urban's roster
      carries five near-duplicate pairs kept deliberately separate
      (`rejects.csv`), so a name that matches more than one person is refused
      into `needsConfirming` rather than bound to a coin flip.
    */
    const byRef = existing.byExternalId.get(p.externalId);
    const nameKey = p.identity.name?.trim().toLowerCase();
    const ambiguous = !!nameKey && existing.ambiguousNames.has(nameKey);
    const byName = !byRef && nameKey && !ambiguous ? existing.byName.get(nameKey) : undefined;
    const match = byRef ?? byName;

    const label = p.identity.name ?? match?.name ?? p.externalId;
    const changes: FieldChange[] = [];
    const needsConfirming: FieldChange[] = [];
    const flaggedInactive = p.observed.employmentStatus === "terminated";

    if (!match) {
      /*
        Nobody to attach to. A create, unless the name was ambiguous — in which
        case creating would ADD a duplicate of somebody already on the roster,
        which is worse than doing nothing and asking.
      */
      if (ambiguous) {
        people.push({
          externalId: p.externalId,
          label,
          action: "skip",
          changes: [],
          needsConfirming: [
            {
              field: "match",
              from: null,
              to: `"${label}" matches more than one person already on the roster — bind it by hand`,
            },
          ],
          flaggedInactive,
          withheld: p.withheld,
        });
        continue;
      }
      for (const [field, to] of Object.entries(p.writable)) {
        if (typeof to === "string") changes.push({ field, from: null, to });
      }
      if (p.identity.code) changes.push({ field: "code", from: null, to: p.identity.code });
      if (p.identity.name) changes.push({ field: "name", from: null, to: p.identity.name });
      people.push({
        externalId: p.externalId,
        label,
        action: "create",
        changes,
        needsConfirming: [],
        flaggedInactive,
        withheld: p.withheld,
      });
      continue;
    }

    /* An existing person. Only genuinely-different values become changes; a
       field that already agrees is not an update, and counting it as one would
       make every run report the whole roster as touched. */
    if (p.writable.email && p.writable.email !== match.email) {
      changes.push({ field: "email", from: match.email, to: p.writable.email });
    }
    /* `jobTitleName`, `divisionName` and `departmentName` are name lookups that
       need the reference tables, so they are resolved at apply time. They are
       still reported here so the preview is honest about intent. */
    for (const field of ["jobTitleName", "divisionName", "departmentName"] as const) {
      const to = p.writable[field];
      if (to) changes.push({ field, from: null, to });
    }

    /*
      IDENTITY. Proposed, never applied to an existing row.

      `code` deserves a note: 81 of Urban's 83 codes are `URB-nnn` placeholders
      minted by the seed generator because neither source CSV carried an
      employee number. So BambooHR's `employeeNumber` is very likely the FIRST
      real badge number this system has seen — which is exactly why it must be
      shown to somebody rather than swapped in silently.
    */
    if (p.identity.code && p.identity.code !== match.code) {
      needsConfirming.push({ field: "code", from: match.code, to: p.identity.code });
    }
    if (p.identity.name && p.identity.name !== match.name) {
      needsConfirming.push({ field: "name", from: match.name, to: p.identity.name });
    }

    people.push({
      externalId: p.externalId,
      label,
      action: changes.length > 0 ? "update" : "skip",
      employeeId: match.id,
      changes,
      needsConfirming,
      flaggedInactive,
      withheld: p.withheld,
    });
  }

  return {
    people,
    refused,
    counts: {
      created: people.filter((p) => p.action === "create").length,
      updated: people.filter((p) => p.action === "update").length,
      skipped: people.filter((p) => p.action === "skip").length,
      refused: refused.length,
      flagged: people.filter((p) => p.flaggedInactive).length,
    },
  };
}

/** Load the tenant's side of the diff. */
export async function loadExisting(db: Database, tenantId: string) {
  const rows = await db
    .select({
      id: schema.employee.id,
      name: schema.employee.name,
      code: schema.employee.code,
      email: schema.employee.email,
      hrFlaggedInactiveAt: schema.employee.hrFlaggedInactiveAt,
    })
    .from(schema.employee)
    .where(eq(schema.employee.tenantId, tenantId));

  const refs = await db
    .select({
      employeeId: schema.employeeExternalRef.employeeId,
      externalId: schema.employeeExternalRef.externalId,
    })
    .from(schema.employeeExternalRef)
    .where(
      and(
        eq(schema.employeeExternalRef.tenantId, tenantId),
        eq(schema.employeeExternalRef.system, "bamboohr"),
      ),
    );

  const byId = new Map(rows.map((r) => [r.id, r]));
  const byExternalId = new Map<string, (typeof rows)[number]>();
  for (const ref of refs) {
    const emp = byId.get(ref.employeeId);
    if (emp) byExternalId.set(ref.externalId, emp);
  }

  /* Names that belong to more than one person cannot be used as a key. Urban
     has five such pairs on purpose, so this set is never empty in practice and
     the first-bind path has to handle it. */
  const byName = new Map<string, (typeof rows)[number]>();
  const ambiguousNames = new Set<string>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    if (byName.has(key)) ambiguousNames.add(key);
    else byName.set(key, r);
  }
  for (const k of ambiguousNames) byName.delete(k);

  return { byExternalId, byName, ambiguousNames, byId };
}

/* ------------------------------------------------------------------ */
/* The apply                                                           */
/* ------------------------------------------------------------------ */

/*
  Resolve a reference row by NAME, creating it if absent.

  BambooHR sends `divisionName` / `departmentName` / `jobTitleName` as strings;
  we store ids. Creating on first sight is deliberate and was settled in the
  plan document — refusing an unknown division would make the whole sync fail
  on a name nobody had typed into Optix yet, and the alternative (drop the
  value) loses data silently.

  `onConflictDoNothing` then re-select rather than a bare insert: two runs, or
  two people in the same new division inside one run, both race the unique
  index on (tenant_id, name).
*/
async function resolveByName(
  db: Database,
  table: typeof schema.division | typeof schema.department | typeof schema.companyRole,
  tenantId: string,
  name: string,
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const found = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.name, trimmed)))
    .limit(1);
  if (found[0]) return found[0].id;
  await db.insert(table).values({ tenantId, name: trimmed }).onConflictDoNothing();
  const again = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.name, trimmed)))
    .limit(1);
  return again[0]?.id ?? null;
}

/*
  Write the plan.

  NOT wrapped in one transaction, deliberately. A roster sync is hundreds of
  rows behind a network fetch, and postgres.js pins one of `max: 10` pool
  connections for the life of a transaction — the same trap `approve.ts`
  documents at length. Each person is independent, so a failure part-way leaves
  the people already written correct and the run reports what it managed. The
  operation is safe to re-run because matching is by `(system, external_id)`.
*/
export async function applySyncPlan(
  db: Database,
  tenantId: string,
  plan: SyncPlan,
  incoming: AdaptedBambooPerson[],
  existingById: Map<string, { hrFlaggedInactiveAt: Date | null }> = new Map(),
): Promise<{ created: number; updated: number; failed: number; firstError: string | null }> {
  const byExternalId = new Map(incoming.map((p) => [p.externalId, p]));
  /* Bamboo id -> our employee id, filled as we go and used by the second pass
     below. Seeded with everyone already bound so a manager who did not change
     this run is still resolvable. */
  const employeeIdByExternal = new Map<string, string>();
  for (const p of plan.people) if (p.employeeId) employeeIdByExternal.set(p.externalId, p.employeeId);

  let created = 0;
  /*
    Row-level failures are COUNTED, not thrown.

    The first real run died on person 520 of 1816 and reported `created: 0`
    while 519 rows sat in the table — the run said nothing happened when a
    third of it had. That is worse than the crash: the report actively
    misinformed the person who pressed the button.

    A per-row catch is the right shape for a bulk importer and is not a
    workaround for an unknown failure — the failure is understood (see the two
    unique indexes below) and the decision is that one unusable record must not
    discard the work already done, nor abandon the 1296 people after it. The
    message is kept so the run can say WHY rather than just how many.
  */
  let failed = 0;
  let firstError: string | null = null;
  let updated = 0;

  for (const step of plan.people) {
   try {
    const person = byExternalId.get(step.externalId);
    if (!person) continue;
    /* A skip with an unresolved match is the ambiguous-name case. Never guess. */
    if (step.action === "skip" && !step.employeeId) continue;

    const divisionId = person.writable.divisionName
      ? await resolveByName(db, schema.division, tenantId, person.writable.divisionName)
      : null;
    const departmentId = person.writable.departmentName
      ? await resolveByName(db, schema.department, tenantId, person.writable.departmentName)
      : null;
    const companyRoleId = person.writable.jobTitleName
      ? await resolveByName(db, schema.companyRole, tenantId, person.writable.jobTitleName)
      : null;

    let employeeId = step.employeeId;

    if (step.action === "create") {
      /*
        `role` is NOT NULL and is the legacy operational role, not the HR job
        title — BambooHR has no opinion about it. `crew` is the least-privileged
        value, so a person arriving from an import can hold nothing they should
        not until somebody sets it deliberately.

        `employmentStatus` is NOT set from Bamboo even here: the column defaults
        to `active`, and a create is by definition somebody Bamboo just told us
        about. A departure is a flag, never a write — `hrFlaggedInactiveAt`
        carries it instead, and it is entirely possible for a person to arrive
        already flagged: a former employee who never had an Optix row before
        this sync creates one that starts flagged rather than blank.
      */
      const [row] = await db
        .insert(schema.employee)
        .values({
          tenantId,
          name: person.identity.name ?? `BambooHR ${person.externalId}`,
          role: "crew",
          ...(person.identity.code ? { code: person.identity.code } : {}),
          ...(person.writable.email ? { email: person.writable.email } : {}),
          ...(divisionId ? { divisionId } : {}),
          ...(departmentId ? { departmentId } : {}),
          ...(companyRoleId ? { companyRoleId } : {}),
          ...(step.flaggedInactive ? { hrFlaggedInactiveAt: new Date() } : {}),
        })
        .returning({ id: schema.employee.id });
      if (!row) continue;
      employeeId = row.id;
      created++;
    } else if (employeeId) {
      /*
        Built as an explicit object, never a spread of `person.writable`.
        `writable` speaks BambooHR's field names (`jobTitleName`) and the table
        speaks ours (`companyRoleId`) — and Drizzle DROPS an unknown key with no
        error that `tsc` cannot see, so a spread here would look correct and
        persist nothing. Four writers in this repo have already been bitten by
        exactly that.

        `code` and `name` are absent on purpose: those are `needsConfirming`,
        reported to a human and never written to an existing person.
      */
      const patch: Record<string, unknown> = {};
      if (person.writable.email) patch.email = person.writable.email;
      if (divisionId) patch.divisionId = divisionId;
      if (departmentId) patch.departmentId = departmentId;
      if (companyRoleId) patch.companyRoleId = companyRoleId;
      /* Only written on an actual STATE CHANGE, checked against what this
         person held before this run — never unconditionally, or `updated`
         would count every synced person as changed the moment this column
         existed, which is exactly the lying-count bug this file already has a
         scar for (see the `created: 0` comment above `applySyncPlan`). */
      const wasFlagged = existingById.get(employeeId)?.hrFlaggedInactiveAt != null;
      if (step.flaggedInactive && !wasFlagged) patch.hrFlaggedInactiveAt = new Date();
      else if (!step.flaggedInactive && wasFlagged) patch.hrFlaggedInactiveAt = null;
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date();
        await db
          .update(schema.employee)
          .set(patch)
          .where(and(eq(schema.employee.id, employeeId), eq(schema.employee.tenantId, tenantId)));
        if (step.action === "update") updated++;
      }
    }

    if (!employeeId) continue;
    employeeIdByExternal.set(person.externalId, employeeId);

    /*
      Bind the person to their BambooHR record. This row is what makes the sync
      re-runnable without duplicating anybody, so it is written on every pass.

      THERE ARE TWO UNIQUE INDEXES ON THIS TABLE AND BOTH CAN FIRE. Handling
      only one of them is what killed the first real run after 519 people:

        eer_system_id_uq        (tenant_id, system, external_id)
        eer_employee_system_uq  (tenant_id, employee_id, system)

      `onConflictDoUpdate` can name ONE arbiter. Targeting the first means an
      insert carrying a NEW external_id for a person who already has a
      bamboohr ref does not conflict on that arbiter at all — so it proceeds to
      the insert and dies on the second index instead, taking the rest of the
      run with it.

      That is not a hypothetical. `seed.ts` binds three real people to
      FABRICATED bamboohr ids (4471/4472/4473). Real BambooHR returned those
      same people under different ids, the name fallback matched the employee,
      and the second index fired.

      So the employee+system row is checked FIRST and a disagreement is
      REPORTED, never silently rebound. Re-pointing a person at a different
      foreign id is exactly the "identity is proposed, not applied" rule that
      governs `code` and `name` — an automatic rebind would quietly reassign
      who a row is, and the next sync would carry the mistake forward as
      settled fact.
    */
    const existingRef = await db
      .select({
        id: schema.employeeExternalRef.id,
        externalId: schema.employeeExternalRef.externalId,
      })
      .from(schema.employeeExternalRef)
      .where(
        and(
          eq(schema.employeeExternalRef.tenantId, tenantId),
          eq(schema.employeeExternalRef.employeeId, employeeId),
          eq(schema.employeeExternalRef.system, "bamboohr"),
        ),
      )
      .limit(1);

    if (existingRef[0] && existingRef[0].externalId !== person.externalId) {
      /* Already bound to a different BambooHR record. Report and move on —
         crashing here abandons every person after this one, and guessing which
         binding is right is not a decision an importer gets to make. */
      step.needsConfirming.push({
        field: "bamboohr link",
        from: existingRef[0].externalId,
        to: person.externalId,
      });
      continue;
    }

    if (existingRef[0]) {
      /* Same person, same id: refresh the payload so a thin record stays
         explainable. Updated by primary key, so neither index is in play. */
      await db
        .update(schema.employeeExternalRef)
        .set({
          lastSyncedAt: new Date(),
          raw: person.raw,
          restrictedFields: person.withheld,
          updatedAt: new Date(),
        })
        .where(eq(schema.employeeExternalRef.id, existingRef[0].id));
      continue;
    }

    /* No row for this employee. `onConflictDoUpdate` on (tenant, system,
       external_id) still matters: that id may already be bound to a DIFFERENT
       employee — a person re-keyed in BambooHR — and moving the binding is
       correct in that direction, because the id is the authority. */
    await db
      .insert(schema.employeeExternalRef)
      .values({
        tenantId,
        employeeId,
        system: "bamboohr",
        externalId: person.externalId,
        lastSyncedAt: new Date(),
        raw: person.raw,
        restrictedFields: person.withheld,
      })
      .onConflictDoUpdate({
        target: [
          schema.employeeExternalRef.tenantId,
          schema.employeeExternalRef.system,
          schema.employeeExternalRef.externalId,
        ],
        set: {
          employeeId,
          lastSyncedAt: new Date(),
          raw: person.raw,
          restrictedFields: person.withheld,
          updatedAt: new Date(),
        },
      });
   } catch (e) {
     failed++;
     if (!firstError) firstError = e instanceof Error ? e.message : String(e);
   }
  }

  /*
    SECOND PASS: the manager edge.

    Separate because a manager may be imported after their report, so the id is
    not resolvable on the first pass. Resolved by Bamboo id — never by
    `reportsToName`, which the adapter deliberately discards.

    A self-reference is dropped by the adapter, and a manager we never saw is
    left alone rather than nulled: absent evidence is not evidence of no
    manager.
  */
  for (const person of incoming) {
    if (!person.reportsToExternalId) continue;
    const self = employeeIdByExternal.get(person.externalId);
    const manager = employeeIdByExternal.get(person.reportsToExternalId);
    if (!self || !manager || self === manager) continue;
    await db
      .update(schema.employee)
      .set({ reportsToEmployeeId: manager, updatedAt: new Date() })
      .where(and(eq(schema.employee.id, self), eq(schema.employee.tenantId, tenantId)));
  }

  return { created, updated, failed, firstError };
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

/** Keeps a provider message from becoming an unbounded column. Matches the
    500-char convention on `tbl_ops_message.error_note`. */
function shortError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.slice(0, 500);
}

/**
 * Execute one queued run to completion.
 *
 * Claim-then-act, the shape `approve.ts` uses: one conditional UPDATE is the
 * claim, so two workers racing the same row serialise inside the statement and
 * the loser matches nothing. No transaction is held across the fetch — that
 * would pin a pool connection for the length of a network call.
 */
export async function executeSyncRun(
  db: Database,
  runId: string,
  creds: BambooCredentials,
): Promise<void> {
  const claimed = await db
    .update(schema.syncRun)
    .set({ status: "running", startedAt: new Date(), lastAttemptAt: new Date(), attempts: sql`${schema.syncRun.attempts} + 1` })
    .where(and(eq(schema.syncRun.id, runId), eq(schema.syncRun.status, "queued")))
    .returning({ id: schema.syncRun.id, tenantId: schema.syncRun.tenantId, mode: schema.syncRun.mode });
  const run = claimed[0];
  if (!run) return; // somebody else claimed it, or it is no longer queued

  try {
    const fetched = await fetchAllBambooEmployees(creds);
    /*
      REFUSE TO APPLY A SHORT READ. A preview of a partial roster is merely
      incomplete; an APPLY of one is destructive in the making — every employee
      past the cut is absent from the payload, and absence is what a leaver
      looks like. Better to fail loudly than to write two thirds of a company.
    */
    if (run.mode === "apply" && !fetched.complete) {
      throw new Error(
        `BambooHR reported ${fetched.reportedTotal} employees but only ${fetched.records.length} were read. Refusing to apply a partial roster — run a preview and try again.`,
      );
    }
    const records = fetched.records;
    const { people, failures } = adaptBambooPage(records);
    const existing = await loadExisting(db, run.tenantId);
    const plan = buildSyncPlan(people, failures, existing);

    let counts = plan.counts;
    let rowErrors: string | null = null;
    if (run.mode === "apply") {
      const applied = await applySyncPlan(db, run.tenantId, plan, people, existing.byId);
      /* The APPLIED numbers, never the planned ones. They differ whenever a row
         failed, and reporting the plan's figures would tell somebody 1816
         people were added when 519 were. */
      counts = {
        ...plan.counts,
        created: applied.created,
        updated: applied.updated,
        refused: plan.counts.refused + applied.failed,
      };
      if (applied.failed > 0) {
        rowErrors = `${applied.failed} record(s) could not be written. First: ${applied.firstError ?? "unknown"}`;
      }
    }

    await db
      .update(schema.syncRun)
      .set({
        status: "done",
        finishedAt: new Date(),
        createdCount: counts.created,
        updatedCount: counts.updated,
        skippedCount: counts.skipped,
        refusedCount: counts.refused,
        flaggedCount: counts.flagged,
        /* Capped: the detail is a report for a screen, and a 2000-person roster
           would otherwise put a megabyte of jsonb in a column somebody selects
           by accident. */
        detail: { people: plan.people.slice(0, 500), refused: plan.refused.slice(0, 100) },
        /* `done` with an errorNote, not `failed`: the run finished and most of
           it worked. Calling a mostly-successful run failed sends somebody
           looking for a crash that did not happen. */
        errorNote: rowErrors,
      })
      .where(eq(schema.syncRun.id, run.id));
  } catch (e) {
    await db
      .update(schema.syncRun)
      .set({ status: "failed", finishedAt: new Date(), errorNote: shortError(e) })
      .where(eq(schema.syncRun.id, run.id));
  }
}

/**
 * The worker tick. Claims queued runs across every tenant.
 *
 * No tenant predicate, and that is one of the two documented exceptions in
 * `.claude/rules/database.md`: a worker has no session and therefore no tenant.
 * It reads `tenantId` off the row it claimed and carries that into everything
 * downstream, and it never takes an id from a caller.
 */
export async function processQueuedSyncRuns(
  db: Database,
  creds: BambooCredentials | null,
): Promise<void> {
  /* No credentials means the sync is not configured. Fail the queued runs with
     a message rather than leaving them queued forever looking like a hang. */
  if (!creds) {
    await db
      .update(schema.syncRun)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorNote: "BambooHR is not configured — set BAMBOOHR_COMPANY_DOMAIN and BAMBOOHR_API_KEY",
      })
      .where(eq(schema.syncRun.status, "queued"));
    return;
  }

  const queued = await db
    .select({ id: schema.syncRun.id })
    .from(schema.syncRun)
    .where(and(eq(schema.syncRun.status, "queued"), eq(schema.syncRun.source, "bamboohr")))
    .limit(5);

  for (const r of queued) await executeSyncRun(db, r.id, creds);
}
