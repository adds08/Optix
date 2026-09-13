/*
  Demo data — the ONE definition of the local-only dummy dataset, shared by
  `apps/api/src/demo-data.ts` (which loads it from `docs/import/*.csv`) and the
  demo tests (which seed the same shape into a throwaway tenant).

  Two rules govern everything in here:

  1. NO INVENTED BUSINESS DATA. The project set, the roster and the imported
     rows are derived from the CSVs already in `docs/import/`. The only invented
     rows are the five demo ACCOUNTS (one per role), which exist so somebody can
     sign in and look at the flows the data is there to exercise.

  2. PURE WHERE IT CAN BE. CSV parsing, the project merge, the roster split and
     the row builders are pure functions of the file text, so the tests can pin
     the merge contract without a database. Only `seedDemoTenant` writes, and it
     writes nothing but the vocabulary a tenant needs to be usable.

  The CSV builders emit rows keyed by the import spec's HEADERS (`tag`,
  `project_code`, `employee_id`, …) — exactly what `import.commit` takes — so the
  loader passes them straight through and there is no second column mapping to
  drift from `packages/types/src/import-specs.ts`.
*/
import { eq } from "drizzle-orm";
import type { Database } from "@optix/db";
import { roleSpecs, teamRoleSpecs } from "@optix/db";
import * as schema from "@optix/db/schema";

/* The single password every demo account shares. Local-only by construction:
   `demo-data.ts` refuses to run against production, and `make demo` says so. */
export const DEMO_PASSWORD = "optix-demo";

/* ---------------------------------------------------------------------------
   The five accounts
   ------------------------------------------------------------------------- */

export type DemoAccount = {
  /** Login-role name — a row in `tbl_entity_role` (`roleSpecs`). */
  role: string;
  /** The team tier this person holds on a job, or null (HR holds none). */
  tier: string | null;
  email: string;
  firstName: string;
  lastName: string;
  /** The `employee` row the login is linked to. */
  employeeName: string;
};

/*
  One account per onboarding story the tests and the manual pass want to see:
  the claimer, the two tiers below it, the wing that skips the wizard, and HR.

  The emails are `.local` on purpose — nothing should ever route mail here, and
  a `.local` address cannot be delivered.
*/
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { role: "director", tier: "director", email: "demo.director@stinventory.local", firstName: "Dana", lastName: "Director", employeeName: "Dana Director" },
  { role: "project_manager", tier: "pm", email: "demo.pm@stinventory.local", firstName: "Pat", lastName: "Manager", employeeName: "Pat Manager" },
  { role: "superintendent", tier: "superintendent", email: "demo.superintendent@stinventory.local", firstName: "Sam", lastName: "Superintendent", employeeName: "Sam Superintendent" },
  { role: "foreman", tier: "foreman", email: "demo.foreman@stinventory.local", firstName: "Frank", lastName: "Foreman", employeeName: "Frank Foreman" },
  { role: "hr", tier: null, email: "demo.hr@stinventory.local", firstName: "Harper", lastName: "Resources", employeeName: "Harper Resources" },
];

/*
  The people the demo tenant carries. The five account holders plus two crew
  members with no login, so a superintendent's crew and a foreman's branch have
  somebody in them to look at.

  `employeeRole` is the legacy `employee.role` vocabulary (nine values) — the
  column the import spec and several readers still use. A director has no
  legacy value, so they are recorded as `pm`; their real authority comes from
  the tier they hold on a job, not from this column.
*/
export type DemoPerson = {
  name: string;
  employeeRole: string;
  /** Login role name, for the account holders only. */
  loginRole?: string;
};

const ACCOUNT_EMPLOYEE_ROLE: Record<string, string> = {
  director: "pm",
  project_manager: "pm",
  superintendent: "superintendent",
  foreman: "foreman",
  hr: "hr",
};

export const DEMO_CREW: readonly DemoPerson[] = [
  { name: "Gina Foreman", employeeRole: "foreman" },
  { name: "Cody Crew", employeeRole: "foreman" },
];

export const DEMO_PEOPLE: readonly DemoPerson[] = [
  ...DEMO_ACCOUNTS.map((a) => ({
    name: a.employeeName,
    employeeRole: ACCOUNT_EMPLOYEE_ROLE[a.role] ?? "foreman",
    loginRole: a.role,
  })),
  ...DEMO_CREW,
];

/* Projects the demo tenant starts with, taken from `01-projects.csv` and
   `project-extraction/projects.csv` (codes present in the real files). The
   loader imports the full merged set; these are the few the test fixture and
   the manual pass name directly. */
export const DEMO_PROJECTS: readonly { code: string; name: string }[] = [
  { code: "10001", name: "Equipment Yard" },
  { code: "22018", name: "Lone Star I-35 East Phase 2" },
  { code: "22017", name: "Alamo NEX Seg N-2" },
];

/* ---------------------------------------------------------------------------
   CSV parsing
   ------------------------------------------------------------------------- */

/**
 * Minimal RFC-4180 CSV reader: quoted fields, doubled quotes, commas and
 * newlines inside quotes, CRLF or LF. Returns rows of raw cells.
 *
 * Hand-rolled rather than pulling a dependency because the only caller reads
 * four files this repository owns, and a library's edge cases (delimiters,
 * encodings, formulas) are not the ones a yard's export uses.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  /* A file that does not end in a newline still has one last row. */
  if (field.length || row.length) pushRow();

  /* Drop a trailing empty row produced by a terminal newline. */
  while (rows.length && rows[rows.length - 1]!.every((c) => c === "")) rows.pop();
  return rows;
}

export type CsvRow = Record<string, string>;

/** Rows keyed by header. Header cells are trimmed; values are not. */
export function csvRows(text: string): CsvRow[] {
  const [headers, ...rows] = parseCsv(text);
  if (!headers) return [];
  const keys = headers.map((h) => h.trim());
  return rows.map((cells) => {
    const out: CsvRow = {};
    keys.forEach((key, idx) => {
      out[key] = cells[idx] ?? "";
    });
    return out;
  });
}

/* ---------------------------------------------------------------------------
   The project merge — the contract the whole demo rests on
   ------------------------------------------------------------------------- */

export type MergedProject = {
  code: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  /** True when both files knew the code but neither carried a real name. */
  needsRealName: boolean;
};

export type ProjectMerge = {
  projects: MergedProject[];
  /** Codes whose name is still `Job NNNNN` — reported, never guessed. */
  needsRealName: string[];
  /**
   * Base-file name → merged name, lowercased keys. This is what lets an
   * employee's `primary_project` of "Job 24002" resolve to the extraction's
   * real name "Frisco Dallas Pkwy - Punchout" instead of being blanked.
   */
  aliases: Map<string, string>;
};

const JOB_PLACEHOLDER = /^Job \d+$/;

/**
 * Merge `01-projects.csv` and `project-extraction/projects.csv` by
 * `project_code`:
 *
 *  - in both → the extraction's real name wins, the base file's status/dates stay
 *  - extraction only → added with its real name and the base placeholder dates
 *  - base only → keep its name; if that name is `Job NNNNN`, report the code as
 *    needing a real name rather than inventing one
 */
export function mergeProjectCsvs(baseCsv: string, extractionCsv: string): ProjectMerge {
  const base = csvRows(baseCsv);
  const extraction = csvRows(extractionCsv);
  const baseByCode = new Map(base.map((r) => [(r.project_code ?? "").trim(), r]));
  const extractionByCode = new Map(extraction.map((r) => [(r.project_code ?? "").trim(), r]));

  const codes = [...baseByCode.keys(), ...[...extractionByCode.keys()].filter((c) => !baseByCode.has(c))];

  const projects: MergedProject[] = [];
  const needsRealName: string[] = [];
  const aliases = new Map<string, string>();

  for (const code of codes) {
    if (!code) continue;
    const fromBase = baseByCode.get(code);
    const fromExtraction = extractionByCode.get(code);

    const baseName = (fromBase?.name ?? "").trim();
    const realName = (fromExtraction?.project_name ?? "").trim();
    const name = realName || baseName;
    if (!name) continue;

    const placeholder = !realName && JOB_PLACEHOLDER.test(name);
    if (placeholder) needsRealName.push(code);

    projects.push({
      code,
      name,
      status: (fromBase?.status ?? "").trim() || "in_progress",
      startDate: (fromBase?.start_date ?? "").trim() || "2025-01-06",
      endDate: (fromBase?.end_date ?? "").trim() || "2030-12-31",
      needsRealName: placeholder,
    });

    /* Every name the base file used for this job, so a reference in another
       spreadsheet still lands on the row after the merge renamed it. */
    if (baseName) aliases.set(baseName.toLowerCase(), name);
  }

  return { projects, needsRealName, aliases };
}

/** Merged projects as `import.commit` project rows (headers from the spec). */
export function projectImportRows(merge: ProjectMerge): CsvRow[] {
  return merge.projects.map((p) => ({
    name: p.name,
    project_code: p.code,
    description: "",
    status: p.status,
    site_address: "",
    start_date: p.startDate,
    end_date: p.endDate,
  }));
}

/* ---------------------------------------------------------------------------
   The roster — no importer exists for this, so it is built from the extraction
   ------------------------------------------------------------------------- */

export type RosterEntry = {
  code: string;
  projectName: string;
  directors: string[];
  pm: string | null;
  foremen: string[];
};

/** Split a `/`-joined name cell into individuals ("Martha / Aaron"). */
export function splitNames(raw: string | undefined): string[] {
  return (raw ?? "")
    .split("/")
    .map((n) => n.trim())
    .filter(Boolean);
}

/*
  Placeholder names in the crew column that are not people: "NEW PE / NEW FE"
  means "a project engineer and a field engineer have not been named yet", and
  creating employees called NEW PE would be inventing data wearing a name.
*/
const NOT_A_PERSON = /^new (pe|fe)$/i;

export function isRealPerson(name: string): boolean {
  return !!name.trim() && !NOT_A_PERSON.test(name.trim());
}

/**
 * The roster spec `{ code → { directors, pm, foremen } }`, from the extraction's
 * `directors` / `manager_candidate` / `crew` columns. Names are split on `/` and
 * the non-people placeholders dropped.
 */
export function buildRoster(extractionCsv: string, projectNameByCode: Map<string, string>): RosterEntry[] {
  const rows = csvRows(extractionCsv);
  const out: RosterEntry[] = [];
  for (const r of rows) {
    const code = (r.project_code ?? "").trim();
    if (!code) continue;
    const pm = (r.manager_candidate ?? "").trim();
    out.push({
      code,
      projectName: projectNameByCode.get(code) ?? code,
      directors: splitNames(r.directors).filter(isRealPerson),
      pm: isRealPerson(pm) ? pm : null,
      foremen: splitNames(r.crew).filter(isRealPerson),
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Row builders for the other three spreadsheets
   ------------------------------------------------------------------------- */

export type NameResolver = (raw: string) => string | null;

/** `03-employees-FALLBACK.csv` → employee import rows. */
export function employeeImportRows(employeesCsv: string, resolveProject: NameResolver): CsvRow[] {
  return csvRows(employeesCsv)
    .filter((r) => (r.name ?? "").trim())
    .map((r) => ({
      name: (r.name ?? "").trim(),
      role: (r.role ?? "").trim(),
      employee_id: (r.employee_id ?? "").trim(),
      email: (r.email ?? "").trim(),
      phone: (r.phone ?? "").trim(),
      status: (r.status ?? "").trim() || "active",
      /* A project reference that does not resolve to a real name after the
         merge is blanked, not guessed — an unresolved ref fails the whole
         all-or-nothing commit. */
      primary_project: resolveProject((r.primary_project ?? "").trim()) ?? "",
    }));
}

/** `02-vehicles.csv` → vehicle import rows. */
export function vehicleImportRows(vehiclesCsv: string, resolveProject: NameResolver, resolveEmployee: NameResolver): CsvRow[] {
  return csvRows(vehiclesCsv)
    .filter((r) => (r.unit ?? "").trim())
    .map((r) => ({
      unit: (r.unit ?? "").trim(),
      type: (r.type ?? "").trim(),
      code: (r.code ?? "").trim(),
      description: (r.description ?? "").trim(),
      plate: (r.plate ?? "").trim(),
      make_model: (r.make_model ?? "").trim(),
      ownership: (r.ownership ?? "").trim() || "company_owned",
      project: resolveProject((r.project ?? "").trim()) ?? "",
      foreman: resolveEmployee((r.foreman ?? "").trim()) ?? "",
    }));
}

/**
 * `04-tools.csv` → asset import rows.
 *
 * `serial` is the import spec's unique key. The real file carries 27 repeat
 * serials (and `N`/`n` count as the same value to the importer, which lowercases
 * before matching), and a single duplicate fails the entire all-or-nothing
 * commit — so the first row for a serial is kept and repeats are dropped.
 */
export function toolImportRows(toolsCsv: string): CsvRow[] {
  const seen = new Set<string>();
  const out: CsvRow[] = [];
  for (const r of csvRows(toolsCsv)) {
    const description = (r.description ?? "").trim();
    if (!description) continue;
    const serial = (r.serial ?? "").trim();
    if (serial) {
      const key = serial.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push({
      tag: (r.tag ?? "").trim(),
      description,
      make: (r.make ?? "").trim(),
      model: (r.model ?? "").trim(),
      category: (r.category ?? "").trim(),
      serial,
      quantity: (r.quantity ?? "").trim() || "1",
      cost: (r.cost ?? "").trim(),
      purchased_on: (r.purchased_on ?? "").trim(),
      warranty_expires: (r.warranty_expires ?? "").trim(),
      other: (r.other ?? "").trim(),
      column_8: (r.column_8 ?? "").trim(),
      location: "",
      owning_project: "",
    });
  }
  return out;
}

/**
 * Keep the first row for whichever employee a truck names, so the
 * one-truck-per-foreman unique index cannot abort the import. Two foremen in the
 * real vehicle file are down for two trucks; the second link is dropped rather
 * than the whole file failing.
 */
export function dedupeTruckForemen(rows: CsvRow[], alreadyHeld: ReadonlySet<string>): CsvRow[] {
  const held = new Set(alreadyHeld);
  return rows.map((r) => {
    if (r.type !== "truck") return r;
    const foreman = (r.foreman ?? "").trim().toLowerCase();
    if (!foreman) return r;
    if (held.has(foreman)) return { ...r, foreman: "" };
    held.add(foreman);
    return r;
  });
}

/* ---------------------------------------------------------------------------
   Seeding a tenant for the tests
   ------------------------------------------------------------------------- */

export type DemoSeed = {
  tenantId: string;
  adminUserId: string;
  /** lowercased name → employee id */
  employees: Map<string, string>;
  /** project code → project id */
  projects: Map<string, string>;
  /** tier name → team-role id */
  tiers: Map<string, string>;
  /** login-role name → the demo account's ids */
  accounts: Map<string, { userId: string; employeeId: string; roleId: string; email: string }>;
  projectId(code: string): string;
  employeeId(name: string): string;
  account(role: string): { userId: string; employeeId: string; roleId: string; email: string };
};

const keyName = (s: string) => s.trim().toLowerCase();

/**
 * Insert the demo vocabulary, people, projects and accounts into a FRESH tenant
 * and return the ids the tests need.
 *
 * This is the test-side half of the fixture; `demo-data.ts` provisions its
 * tenant with `provision.ts` and imports the real CSVs on top. What the two
 * share is the accounts, the people list and — through `roleSpecs` /
 * `teamRoleSpecs` — the same ladder and role defaults the product ships, so a
 * test that seeds here is testing the shape a real tenant starts from.
 *
 * No permissions are written: every test caller passes its permission set
 * explicitly, which is what keeps the RBAC matrix as the single source of what
 * a role may do.
 */
export async function seedDemoTenant(
  db: Database,
  opts: { name?: string; slug?: string } = {},
): Promise<DemoSeed> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(schema.tenant)
    .values({ name: opts.name ?? `Demo ${suffix}`, slug: opts.slug ?? `demo-${suffix}` })
    .returning({ id: schema.tenant.id });
  const tenantId = tenant!.id;

  const [admin] = await db
    .insert(schema.user)
    .values({
      tenantId,
      email: `demo-admin-${suffix}@stinventory.local`,
      passwordHash: "unused",
      firstName: "Demo",
      lastName: "Admin",
    })
    .returning({ id: schema.user.id });
  const adminUserId = admin!.id;

  /* Roles — the product's own defaults, so `onboardingKind` and
     `claimTierNames` are the real ones rather than a test's idea of them. */
  const roleRows = await db
    .insert(schema.role)
    .values(
      roleSpecs.map((spec) => ({
        tenantId,
        name: spec.name,
        description: spec.description,
        category: spec.category ?? null,
        needsLogin: spec.needsLogin,
        canHoldCustody: spec.canHoldCustody,
        usesFieldLayout: spec.usesFieldLayout,
        onboardingKind: spec.onboardingKind,
        claimTierNames: spec.claimTierNames ?? [],
        isSystem: spec.isSystem,
      })),
    )
    .returning({ id: schema.role.id, name: schema.role.name });
  const roleIdByName = new Map(roleRows.map((r) => [r.name, r.id]));

  /* Tiers — the shipped ladder, edges and "Set by" included. */
  const tierRows = await db
    .insert(schema.teamRole)
    .values(teamRoleSpecs.map((t) => ({ tenantId, name: t.name, label: t.label, canHoldCustody: t.canHoldCustody })))
    .returning({ id: schema.teamRole.id, name: schema.teamRole.name });
  const tierIdByName = new Map(tierRows.map((t) => [t.name, t.id]));
  for (const spec of teamRoleSpecs) {
    const self = tierIdByName.get(spec.name);
    if (!self) continue;
    if (spec.reportsTo) {
      await db
        .update(schema.teamRole)
        .set({ reportsToTeamRoleId: tierIdByName.get(spec.reportsTo) ?? null })
        .where(eq(schema.teamRole.id, self));
    }
    const assigners = spec.setBy.map((n) => tierIdByName.get(n)).filter((id): id is string => !!id);
    if (assigners.length) {
      await db
        .insert(schema.teamRoleAssigner)
        .values(assigners.map((assignerTeamRoleId) => ({ teamRoleId: self, assignerTeamRoleId })));
    }
  }

  /* People. */
  const employeeRows = await db
    .insert(schema.employee)
    .values(
      DEMO_PEOPLE.map((p) => ({
        tenantId,
        name: p.name,
        role: p.employeeRole,
        roleId: p.loginRole ? roleIdByName.get(p.loginRole) ?? null : roleIdByName.get("crew") ?? null,
        employmentStatus: "active",
      })),
    )
    .returning({ id: schema.employee.id, name: schema.employee.name });
  const employeeIdByName = new Map(employeeRows.map((e) => [keyName(e.name), e.id]));

  /* Projects. */
  const projectRows = await db
    .insert(schema.project)
    .values(
      DEMO_PROJECTS.map((p) => ({
        tenantId,
        code: p.code,
        name: p.name,
        status: "in_progress",
        startDate: "2025-01-06",
        endDate: "2030-12-31",
      })),
    )
    .returning({ id: schema.project.id, code: schema.project.code });
  const projectIdByCode = new Map(projectRows.map((p) => [p.code!, p.id]));

  /* Accounts — one login per demo role, linked to that role's employee. */
  const accounts = new Map<string, { userId: string; employeeId: string; roleId: string; email: string }>();
  for (const account of DEMO_ACCOUNTS) {
    const employeeId = employeeIdByName.get(keyName(account.employeeName));
    const roleId = roleIdByName.get(account.role);
    if (!employeeId || !roleId) continue;
    const [user] = await db
      .insert(schema.user)
      .values({
        tenantId,
        employeeId,
        email: account.email,
        passwordHash: "unused",
        firstName: account.firstName,
        lastName: account.lastName,
        mustChangePassword: false,
      })
      .returning({ id: schema.user.id });
    await db.insert(schema.userRole).values({ userId: user!.id, roleId });
    accounts.set(account.role, { userId: user!.id, employeeId, roleId, email: account.email });
  }

  return {
    tenantId,
    adminUserId,
    employees: employeeIdByName,
    projects: projectIdByCode,
    tiers: tierIdByName,
    accounts,
    projectId(code: string): string {
      const id = projectIdByCode.get(code);
      if (!id) throw new Error(`demo fixture: no project ${code}`);
      return id;
    },
    employeeId(name: string): string {
      const id = employeeIdByName.get(keyName(name));
      if (!id) throw new Error(`demo fixture: no employee ${name}`);
      return id;
    },
    account(role: string) {
      const a = accounts.get(role);
      if (!a) throw new Error(`demo fixture: no account for ${role}`);
      return a;
    },
  };
}
