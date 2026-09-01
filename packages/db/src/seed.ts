import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { PERMISSIONS, ROLES } from "@stinventory/types";
import * as schema from "./schema/index.js";
import { ROLE_PERMS } from "./role-perms.js";
import {
  asset,
  assignment,
  authToken,
  category,
  channel,
  department,
  companyRole,
  uomCategory,
  unitOfMeasure,
  employeeContact,
  employee,
  employeeProjectAssignment,
  location,
  message,
  permission,
  project,
  projectTeamMember,
  role,
  rolePermission,
  task,
  tenant,
  tenantSettings,
  tenantFeature,
  transaction,
  transfer,
  user,
  userRole,
  vehicle,
  warehouse,
} from "./schema/index.js";
/* The static vocabularies are shared by both datasets — a category, a role and a
   unit of measure mean the same thing whichever register is loaded. */
import {
  categorySpecs,
  departmentSpecs,
  companyRoleSpecs,
  roleSpecs,
  legacyEmployeeRoleToRole,
  uomCategorySpecs,
  uomSpecs,
} from "./seed-data.js";
import * as demoDataset from "./seed-data.js";
import * as urbanDataset from "./seed-data.urban.js";

/*
  TWO datasets, and they answer different questions.

  `seed-data.ts` is a TEST FIXTURE. Its people, tools and fifteen per-role
  accounts are engineered so every permission tier is reachable and assertable —
  rbac-matrix.test.ts signs in as each of them and proves the visibility ladder
  narrows, which only works because a PM and a superintendent were built to hold
  deliberately different sets. Replacing it wholesale with real data removed
  those accounts and those relationships, and five of its thirty-six tests
  stopped being runnable at all. A security test that cannot run is worse than a
  failing one.

  `seed-data.urban.ts` is Urban Infraconstruction's REAL register, generated from
  the enclosed-trailer workbook and the company vehicle list, carrying one real
  owner account and no demo passwords.

  So neither replaces the other. SEED_DATASET=urban loads the real one; anything
  else keeps the fixture, which is what CI, the tests and a local dev database
  all want.
*/
const USE_URBAN = process.env.SEED_DATASET === "urban";
const {
  assetSpecs,
  assignSpecs,
  employeeSpecs,
  locSpecs,
  postingSpecs,
  projectSpecs,
  teamSpecs,
  txSpecs,
  userSpecs,
  vehLocSpecs,
  vehSpecs,
} = USE_URBAN ? urbanDataset : demoDataset;

const url = process.env.DATABASE_URL ?? "postgres://postgres:stinventory@localhost:5433/stinventory";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

// Fixed "today" for deterministic overdue detection (matches the prototype).
const TODAY = "2026-07-09";

/*
  Acquisition costs, by tag (STI-108). The tools-list source carries no prices,
  and for most rows that stays true on purpose: imported rows routinely have no
  price, and `custodyOutcome` counts null as 0, not "needs approval". But with
  EVERY cost null the high-value gate was unreachable from a clean seed — the
  approval queue, the desk notification and the whole second-signature path had
  never been exercisable without hand-editing rows in psql (found by STI-105).

  The tenant's highValueThreshold is seeded at 5000 below. TOOL-0053 sits at
  exactly 5000.00 because the rule is `>=`, not `>` (pinned by rules.test.ts) —
  the seed demonstrates the edge, and TOOL-0255 at 4999.99 demonstrates the
  other side of it. Values are realistic street prices for the tool named.
*/
/*
  Which shelf a tool goes on, read off its description (STI-104).

  The imported tools list has no category column, so every asset was seeded
  with `categoryName: null` — which left the register's Category column reading
  "—" on all 756 rows and `category.list` returning nothing at all. The bulk
  re-file picker then had zero options, so the feature could not be exercised
  from a clean database.

  Keyword matching, not a lookup table, because the descriptions are free text
  typed by whoever built the spreadsheet ("ANGEL GRAINDER", "QUIKIE SAW") and a
  per-tag map would rot the moment the list is reloaded. Anything unmatched
  stays NULL — an honest "not filed yet", which is also what gives the desk
  something to actually re-file.
*/
const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/\b(DRILL|DRIVER|IMPACT WRENCH|HAMMER)\b/i, "Drills & Drivers"],
  [/\b(GRINDER|GRAINDER)\b/i, "Grinders"],
  [/\b(SAW)\b/i, "Saws"],
  [/\b(COMPACTOR|PLATE|RAMMER|TAMPER)\b/i, "Compaction"],
  [/\b(GENERATOR|POWER STATION|CORD)\b/i, "Generators & Power"],
  [/\b(BLOWER|TRIMMER|EDGER)\b/i, "Blowers & Yard"],
  [/\b(LEVEL|TRANSIT|GNSS|RECEIVER|WALLSCANNER|LASER)\b/i, "Survey & Layout"],
];

function categoryFor(description: string | null): string | null {
  if (!description) return null;
  for (const [pattern, name] of CATEGORY_KEYWORDS) {
    if (pattern.test(description)) return name;
  }
  return null;
}

const SEED_COSTS: Record<string, string> = {
  "TOOL-0001": "289.00", // BOSCH 11255VSR hammer drill
  "TOOL-0002": "129.00", // BOSCH GWS10-450P angle grinder
  "TOOL-0004": "1149.00", // STIHL TS-420 quickie saw
  "TOOL-0010": "219.00", // STIHL BG56C leaf blower
  "TOOL-0013": "2850.00", // WACKER WP1550AW plate compactor
  "TOOL-0020": "3899.00", // WACKER GP6600 generator
  "TOOL-0053": "5000.00", // HONDA EB6500X generator — exactly AT the threshold (>= fires)
  "TOOL-0054": "3200.00", // MIKASA MVC-82VHW plate compactor
  "TOOL-0090": "3750.00", // WACKER GP6500 generator
  "TOOL-0106": "5450.00", // MULTIQUIP MVC-88VTHW plate compactor — above threshold
  "TOOL-0142": "5200.00", // HONDA EB6500X generator — above threshold
  "TOOL-0255": "4999.99", // HONDA EB6500X generator — one cent BELOW the threshold (auto)
};


async function main() {
  console.log("[seed] target:", url.replace(/:[^@]+@/, ":***@"));
  /* Say which register is being written. Loading the demo fixture onto a real
     deployment, or Urban's register onto a machine running the RBAC tests, both
     look like success without this line. */
  console.log(
    USE_URBAN
      ? "[seed] dataset: URBAN — the real register (SEED_DATASET=urban)"
      : "[seed] dataset: demo fixture — set SEED_DATASET=urban for the real register",
  );

  if (process.env.SEED_RESET === "1") {
    console.log("[seed] SEED_RESET=1 — wiping data first");
    /* The ledger is append-only, enforced by trigger since 0014_append_only_ledger
       (STI-104): both the direct delete below and the cascades from asset/tenant
       would raise 0A000 with it armed. The demo wipe is the one sanctioned
       exception, so drop the guard for exactly this block — never weaken the
       trigger itself. Owner-only ALTER. One transaction, not try/finally: a
       `finally` never runs on SIGKILL or a dropped connection, which would leave
       the ledger silently unguarded until the next seed. ALTER TABLE is
       transactional in Postgres, so any abort rolls the DISABLE back along with
       the deletes — the guard cannot survive a crash in the off state. */
    await db.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
      await tx.delete(asset);
      await tx.delete(transaction);
      await tx.delete(vehicle);
      await tx.delete(location);
      await tx.delete(employeeProjectAssignment); // before employees — it points at them
      await tx.delete(projectTeamMember); // before employees and projects — it points at both
      await tx.delete(employee);
      await tx.delete(project);
      await tx.delete(warehouse);
      await tx.delete(userRole);
      await tx.delete(rolePermission);
      await tx.delete(role);
      await tx.delete(user);
      await tx.delete(permission);
      await tx.delete(tenantSettings);
      await tx.delete(tenantFeature);
      await tx.delete(tenant);
      await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
    });
  }

  /*
    The seed REPLACES a database; it does not merge into one.

    The shared-password demo accounts this guard was written for are gone — one
    owner account is seeded now, with a password from SEED_OWNER_PASSWORD or a
    generated one printed once. The guard stays, because the reason widened
    rather than disappeared: SEED_RESET=1 deletes every tenant, employee,
    vehicle, asset and ledger row, and the ledger's append-only trigger is
    dropped to do it. That is right on a fresh deployment and catastrophic on a
    live one, and "we will remember" is not a control.
  */
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
    console.error(
      "[seed] refusing to run with NODE_ENV=production — this wipes and replaces the " +
        "database. Set SEED_ALLOW_PRODUCTION=1 only if you are certain it is empty " +
        "or expendable, and take a backup first.",
    );
    process.exit(1);
  }

  const existing = await db.query.tenant.findMany({ limit: 1 });
  if (existing.length > 0 && process.env.SEED_RESET !== "1") {
    console.log("[seed] tenant already exists; skipping. Re-run with SEED_RESET=1 to wipe and reseed.");
    await client.end();
    return;
  }

  // ---- Tenant ----
  const [t] = await db
    .insert(tenant)
    .values({ name: "Urban Infraconstruction LLC", slug: "urban" })
    .returning();
  if (!t) throw new Error("tenant insert failed");
  const tid = t.id;
  console.log(`[seed] tenant ${t.slug}`);

  // ---- Permissions + roles ----
  await db.insert(permission).values(PERMISSIONS.map((name) => ({ name }))).onConflictDoNothing();
  /* Roles carry their description and their behaviour flags now, not just a
     name. `roleSpecs` is the register; `ROLE_PERMS` in role-perms.ts is still
     what each one GRANTS, seeded here as the default an administrator then
     edits on the Roles screen. */
  const roles = await db
    .insert(role)
    .values(
      roleSpecs.map((r) => ({
        tenantId: tid,
        name: r.name,
        description: r.description,
        needsLogin: r.needsLogin,
        canHoldCustody: r.canHoldCustody,
        usesFieldLayout: r.usesFieldLayout,
        isSystem: r.isSystem,
      })),
    )
    .returning();
  const roleByName = Object.fromEntries(roles.map((r) => [r.name, r]));
  for (const r of roles) {
    const perms = ROLE_PERMS[r.name as (typeof ROLES)[number]] ?? [];
    if (perms.length) {
      await db
        .insert(rolePermission)
        .values(perms.map((p) => ({ roleId: r.id, permissionName: p })))
        .onConflictDoNothing();
    }
  }

  // ---- Departments ----
  /* Repair & Maintenance is infrastructure; Equipment and Purchased are the
     two cost owners the tools-list mapping assigns to (serial -> Equipment,
     no serial -> Purchased). */
  const deptRows = await db
    .insert(department)
    .values(departmentSpecs.map((dd) => ({ tenantId: tid, name: dd.name, code: dd.code, isActive: true })))
    .returning();
  const deptByCode = Object.fromEntries(deptRows.map((d) => [d.code, d.id]));

  // ---- Company roles (job titles) ----
  /* Distinct from `employee.role`: this is what HR calls the job, and nothing
     branches on it. Seeded so `employee.company_role_id` resolves to a name. */
  const roleRows = await db
    .insert(companyRole)
    .values(companyRoleSpecs.map((r) => ({ tenantId: tid, name: r.name, code: r.code, isActive: true })))
    .returning();
  const companyRoleByCode = Object.fromEntries(roleRows.map((r) => [r.code!, r.id]));

  // ---- Units of measure ----
  /* Seeded rather than left empty, so the category axis is exercised by real
     rows: LS sits alone under lump-sum precisely because it converts to
     nothing, and SF/SY share an area category while FT/YD share length —
     which is the distinction that stops "add square feet to yards". */
  const uomCatRows = await db
    .insert(uomCategory)
    .values(uomCategorySpecs.map((c) => ({ tenantId: tid, code: c.code, name: c.name, isActive: true })))
    .returning();
  const uomCatByCode = Object.fromEntries(uomCatRows.map((c) => [c.code, c.id]));
  await db.insert(unitOfMeasure).values(
    uomSpecs.map((u) => ({
      tenantId: tid,
      symbol: u.symbol,
      name: u.name,
      categoryId: uomCatByCode[u.category] ?? null,
      isActive: true,
    })),
  );

  // ---- Categories ----
  /* STI-104. The tools list has no category column, so these are the shelves
     the descriptions fall into. Without them `category.list` is empty and the
     bulk re-file picker has nothing to offer — see the note in seed-data.ts. */
  await db.insert(category).values(categorySpecs.map((name) => ({ tenantId: tid, name })));

  // ---- Employees (domain persons; custody holders) ----
  // Insert projects first (employees reference primaryProjectId).
  const projectRows = await db
    .insert(project)
    .values(
      projectSpecs.map((p) => ({
        tenantId: tid,
        externalId: p.extId,
        name: p.name,
        description: p.description ?? null,
        status: p.status,
        siteAddress: p.site,
        startDate: p.start,
        endDate: p.end,
      })),
    )
    .returning();
  const projectByKey: Record<string, string> = {};
  projectSpecs.forEach((p, i) => (projectByKey[p.key] = projectRows[i]!.id));

  const employeeRows = await db
    .insert(employee)
    .values(
      employeeSpecs.map((e) => ({
        tenantId: tid,
        externalId: e.extId,
        name: e.name,
        role: e.role,
        primaryProjectId: e.primary ? projectByKey[e.primary]! : null,
        employmentStatus: e.status,
        terminatedAt: e.status === "terminated" ? new Date("2026-07-05") : null,
        email: e.email,
        phone: e.phone,
        /* The HR job title, mapped from the operational role where the two
           happen to line up. They are different axes and this is only a seed
           convenience — nothing in the product may branch on it. */
        companyRoleId:
          companyRoleByCode[
            ({ foreman: "FRMN", superintendent: "SUPT", pm: "PM", equipment_admin: "EQMGR",
               mechanic: "MECH", warehouse: "YARD" } as Record<string, string>)[e.role] ?? "LABR"
          ] ?? null,
      })),
    )
    .returning();

  /*
    Contact numbers, one row per number.

    Backfilled from `employee.phone` as the primary, plus a second number for
    the two people the field screens are demonstrated on — because a table that
    only ever holds one row per person tests nothing that `employee.phone` did
    not already do, and the partial unique index (`one primary per employee`)
    would never be exercised.
  */
  const contactValues = employeeSpecs.flatMap((e, i) => {
    const employeeId = employeeRows[i]!.id;
    const rows: { tenantId: string; employeeId: string; kind: string; value: string; isPrimary: boolean }[] = [];
    if (e.phone) rows.push({ tenantId: tid, employeeId, kind: "mobile", value: e.phone, isPrimary: true });
    /* A work line as well, so at least one person has two numbers and the
       "exactly one primary" rule has something to be true about. */
    if (e.key === "e-fm001" || e.key === "e-mech001") {
      rows.push({ tenantId: tid, employeeId, kind: "work", value: "214-555-0400", isPrimary: false });
    }
    return rows;
  });
  if (contactValues.length) await db.insert(employeeContact).values(contactValues);
  const empByKey: Record<string, string> = {};
  employeeSpecs.forEach((e, i) => (empByKey[e.key] = employeeRows[i]!.id));

  /*
    The person's role, from the role register.

    Everyone who is not a custodian and has no desk account is `crew` — the
    no-login role — which is what makes that flag reachable from a clean
    database rather than a column nobody has ever set. Everyone else maps from
    the legacy nine-value enum, which only needed `pm` -> `project_manager`.
  */
  const accountEmployeeKeys = new Set(userSpecs.map((u) => u.employeeKey).filter(Boolean) as string[]);
  for (let i = 0; i < employeeSpecs.length; i++) {
    const e = employeeSpecs[i]!;
    const mapped = legacyEmployeeRoleToRole[e.role];
    /* A plain foreman with no login is crew: he holds tools and never signs in.
       A foreman WITH an account keeps the foreman role and its permissions. */
    const isCrew = e.role === "foreman" && !accountEmployeeKeys.has(e.key);
    const target = isCrew ? "crew" : mapped;
    const rid = target ? roleByName[target]?.id : undefined;
    if (rid) {
      await db.update(employee).set({ roleId: rid }).where(eq(employee.id, employeeRows[i]!.id));
    }
  }

  // Two-pass: update reportsToEmployeeId after all employees are inserted.
  for (const e of employeeSpecs) {
    if (e.reportsTo && empByKey[e.reportsTo]) {
      await db
        .update(employee)
        .set({ reportsToEmployeeId: empByKey[e.reportsTo] })
        .where(eq(employee.id, empByKey[e.key]!));
    }
  }

  // ---- Job postings ----
  // One open posting per trailer foreman — the backtrack behind "tools follow
  // the foreman", driven by the tools-list assignments.
  await db.insert(employeeProjectAssignment).values(
    postingSpecs.map((p) => ({
      tenantId: tid,
      employeeId: empByKey[p.emp]!,
      projectId: projectByKey[p.proj]!,
      startedOn: p.from,
      endedOn: p.to,
      note: p.note,
    })),
  );
  console.log(`[seed] ${postingSpecs.length} postings`);

  // ---- Project team roster ----
  // A foreman row here means that foreman is working that project — the rule
  // the Tools by Jobsite hub and the server-side project scope read.
  await db.insert(projectTeamMember).values(
    teamSpecs.map((s) => ({
      tenantId: tid,
      projectId: projectByKey[s.proj]!,
      employeeId: empByKey[s.emp]!,
      role: s.role,
      startedOn: s.from,
      note: s.note,
    })),
  );
  console.log(`[seed] ${teamSpecs.length} project team members`);

  // ---- Login users ----
  /* The real register gets a real credential; the fixture keeps its shared one.
     `stinventory-demo` used to be hardcoded for all fifteen accounts, one of them
     an owner with every permission — fine for a throwaway demo database, and a
     full compromise on any deployment reachable from the internet.

     The DEMO fixture keeps that password on purpose: `e2e/roles.ts` signs every
     browser test in with it and the login page offers one-click demo accounts
     that use it, so changing it there breaks the suite for no gain — that
     dataset is not meant to exist anywhere real.

     The URBAN dataset takes SEED_OWNER_PASSWORD, or a random one printed ONCE,
     so a real deployment never ends up with a credential that is in git. */
  const generatedPassword =
    USE_URBAN && !process.env.SEED_OWNER_PASSWORD ? randomBytes(12).toString("base64url") : null;
  const seedPassword = USE_URBAN
    ? process.env.SEED_OWNER_PASSWORD ?? generatedPassword!
    : "stinventory-demo";
  const passwordHash = await bcrypt.hash(seedPassword, 10);
  /* The one pending-invite row (see the comment on `userSpecs`) gets a
     password nobody was ever shown rather than the shared demo one — sharing
     it would let this "invited" account sign in the normal way, which is
     exactly the state an invite is supposed to prevent until accepted. */
  const unusablePasswordHash = await bcrypt.hash(randomBytes(24).toString("base64url"), 10);
  const userRows = await db
    .insert(user)
    .values(
      userSpecs.map((u) => ({
        tenantId: tid,
        employeeId: u.employeeKey ? empByKey[u.employeeKey]! : null,
        email: u.email,
        passwordHash: u.pendingInvite ? unusablePasswordHash : passwordHash,
        firstName: u.first,
        lastName: u.last,
        /* Defaults to active; one seeded account is deactivated so STI-303's
           Deactivated badge and Reactivate button are reachable from a clean
           database, and one more is a pending invite (isActive false for a
           different reason — see `pendingInvite` below). */
        isActive: u.isActive ?? true,
      })),
    )
    .returning();
  const userByEmail = Object.fromEntries(userRows.map((u) => [u.email, u]));
  /* The account the seed itself acts as: it creates the asset rows, actors the
     genesis ledger events and owns the seeded desk messages. It named the demo
     equipment-admin, which no longer exists — three separate call sites each
     asserted it non-null, so deleting that account broke the seed in three
     places at once. Resolved once, here, and falls back to the first seeded
     account (the owner), which is honest: on a real deployment the import IS
     performed by whoever holds the system. */
  const seedActor = userByEmail["admin@stinventory.local"] ?? userRows[0]!;
  for (const u of userRows) {
    const spec = userSpecs.find((s) => s.email === u.email)!;
    await db.insert(userRole).values({ userId: u.id, roleId: roleByName[spec.role]!.id });
  }
  console.log(`[seed] ${userRows.length} users, ${employeeRows.length} employees`);

  /*
    The invite token itself. `hashAuthToken` in packages/auth is not imported
    here on purpose — packages/auth already depends on packages/db (for
    `Database`/schema types), so importing it back would be a circular
    workspace dependency. SHA-256 of the raw token is the whole of that
    function; reproduced inline rather than restructured for one caller.
  */
  for (const spec of userSpecs) {
    if (!spec.pendingInvite) continue;
    const u = userByEmail[spec.email]!;
    const token = randomBytes(32).toString("base64url");
    await db.insert(authToken).values({
      tenantId: tid,
      userId: u.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      kind: "invite",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    /* The plaintext exists nowhere else — same rule as a real invite email —
       so it is printed here for whoever is exercising this path locally.
       Never logged for the other seeded users; this is the one row where
       there is deliberately no working password otherwise. */
    console.log(`[seed] pending invite for ${spec.email}: /invite/${token}`);
  }

  // ---- Warehouses + locations + vehicles ----
  const whRows = await db
    .insert(warehouse)
    .values([
      { tenantId: tid, name: "Main Warehouse — Dallas", region: "TX-North", address: "Dallas, TX" },
    ])
    .returning();
  const whByName = Object.fromEntries(whRows.map((w) => [w.name, w.id]));

  // Non-vehicle locations (warehouses). Vehicle locations are one per trailer.
  const allLocRows = await db
    .insert(location)
    .values(
      [...locSpecs, ...vehLocSpecs].map((l) => ({
        tenantId: tid,
        type: l.type,
        name: l.name,
        warehouseId: (l as any).warehouse ? whByName[(l as any).warehouse]! : null,
        projectId: (l as any).project ? projectByKey[(l as any).project]! : null,
        custodianEmployeeId: l.custodian ? empByKey[l.custodian]! : null,
      })),
    )
    .returning();
  const locByKey: Record<string, string> = {};
  [...locSpecs, ...vehLocSpecs].forEach((l, i) => (locByKey[l.key] = allLocRows[i]!.id));

  // Vehicles (1:1 with vehicle locations). The tools-list source has trailers
  // only — every truck column is null by spec — so all rows are trailers.
  const vehicleRows = await db.insert(vehicle).values(
    vehSpecs.map((v) => ({
      tenantId: tid,
      locationId: locByKey[v.loc]!,
      vehicleType: v.vtype,
      /* CAPABILITY, not current state: a truck can tow, a trailer can be towed.
         What is hitched to what right now lives in `assignment.trailerId`,
         where it is ledger-derived like every other "where is it". */
      canAttach: v.vtype === "truck",
      isAttachable: v.vtype === "trailer",
      /* Falls back to the structural type rather than the column default: a
         trailer is an attachment, and a dataset that predates the category
         should still file itself correctly instead of calling everything a
         vehicle. */
      equipmentClass: v.eclass ?? (v.vtype === "trailer" ? "attachment" : "vehicle"),
      vin: v.vin ?? null,
      code: v.code ?? null,
      description: v.description ?? null,
      unit: v.unit,
      plate: v.plate,
      makeModel: v.make,
      ownershipType: v.own,
      payeeEmployeeId: v.payee ? empByKey[v.payee]! : null,
      allowanceRate: v.allow ?? null,
      allowanceFrequency: v.freq ?? null,
      gpsLat: v.lat,
      gpsLng: v.lng,
      /* No coordinates means no ping ever arrived, so there is no timestamp
         either — that pair is what vehicleStatus reads as "no_signal", and a
         seed that stamped gpsAt on a vehicle with no fix would claim a report
         that never happened. */
      gpsAt: v.lat === null ? null : new Date(TODAY),
      gpsSource: "seed",
      projectId: v.proj ? projectByKey[v.proj]! : null,
      foremanEmployeeId: v.foreman ? empByKey[v.foreman]! : null,
    })),
  ).returning();
  /* Location key -> TRAILER id, so an assignment whose `loc` is a trailer's
     location row can also carry that trailer in `trailer_id` (STI-202).
     Filtered by vtype so the synthetic truck below can never land in a
     trailer slot — assignment_trailer_fk would reject it anyway. */
  const trailerIdByLocKey: Record<string, string> = {};
  vehSpecs.forEach((v, i) => {
    if (v.vtype === "trailer") trailerIdByLocKey[v.loc] = vehicleRows[i]!.id;
  });
  /* The one SYNTHETIC truck — see the rationale on its vehSpecs entry.
     TOOL-0001 below rides on it so a real assignment row exercises
     assignment_truck_fk and a real ledger event carries a uuid truckId. */
  const seedTruckId = vehicleRows[vehSpecs.findIndex((v) => v.vtype === "truck")]!.id;
  /*
    ONE assignment in the MODEL-CORRECT shape (STI-207).

    Every other seeded row puts the tool's location AT its trailer's own
    location row, so "aboard by the assignment" and "aboard by the location"
    agree on all 754 of them. That agreement is exactly why the container
    hand-over bug was invisible: both signals said the same thing, so it did
    not matter which one `applyContainerCustody` read.

    The shape STI-202's schema comment actually prescribes is the other one —
    the vehicle lives in `trailerId`, and `locationId` carries a NON-vehicle
    place. This tool is therefore aboard its trailer by the assignment and
    parked in the Dallas Yard by its location. Hand that trailer over and it
    must move; under the old location-based query it silently did not.

    `CLAUDE.md` rule 8: seed the edge that trips the rule, not just the happy
    path. Data the seed cannot produce is behaviour nobody tests.

    Chosen by position, not hardcoded by tag, so it survives the source sheets
    changing. TOOL-0001 is excluded because it carries the synthetic truck and
    is already doing a different job.
  */
  const modelCorrectTag =
    assignSpecs.find((s) => s.tag !== "TOOL-0001" && trailerIdByLocKey[s.loc])?.tag ?? null;
  /* The personal-allowance truck and the one tool riding it — see the rationale
     on its vehSpecs entry. Without a tool on it the "personal" marker on the
     jobsite table, tool detail and the approval queue stays unreachable from a
     clean database. */
  /* OPTIONAL, and it has to be: Urban's real imported fleet is entirely
     company-owned, so a dataset generated from the source sheets carries no
     personal-allowance vehicle at all. This used to be a bare non-null
     assertion, which made `findIndex` return -1, `vehicleRows[-1]` undefined,
     and the whole seed die on `.id` — the demo dataset's synthetic personal
     truck was silently load-bearing. When there is no such vehicle no tool
     rides one, which is the honest outcome; inventing an ownership type to
     keep a fixture reachable would put a lie in the register. */
  const personalTruckIdx = vehSpecs.findIndex((v) => v.own === "personal_allowance");
  const seedPersonalTruckId = personalTruckIdx >= 0 ? vehicleRows[personalTruckIdx]!.id : null;
  const personalTruckTag =
    seedPersonalTruckId === null
      ? null
      : assignSpecs.find((s) => s.tag !== "TOOL-0001" && s.tag !== modelCorrectTag)?.tag ?? null;
  const truckIdFor = (tag: string | null) =>
    tag === "TOOL-0001" ? seedTruckId : tag === personalTruckTag ? seedPersonalTruckId : null;
  const YARD_LOC_KEY = "l-dal";
  /* The location the three writers below agree on. `trailerId` deliberately
     keeps using the ORIGINAL key — that is the whole point: the trailer is
     still recorded, the location no longer names it. */
  const locKeyOf = (tag: string | null, loc: string) => (tag === modelCorrectTag ? YARD_LOC_KEY : loc);
  const trailerCount = vehSpecs.filter((v) => v.vtype === "trailer").length;
  console.log(`[seed] ${trailerCount} trailers (no trucks in source) + 2 synthetic trucks (1 company, 1 personal-allowance)`);

  // ---- Assets (the register). current_* projection set at seed time; matching
  // transactions are appended below so the rebuild guarantee holds.
  // `make`/`modelNumber`/`description` are the flat columns Urban's sheets use.
  // No model catalog: the tools-list source carries its own make/model strings.
  // Cost target: serialized tools -> Equipment Department, the rest -> the
  // Purchased project they ride with.
  /*
    Warranty dates, and specifically the FUTURE ones (UI-60/62/63/64/65).

    Every asset carried `warranty_expires_on = NULL`, so the whole warranty
    surface — the "expires in N days" hint on tool detail and the
    warranty_soon / warranty_expired badges — was unreachable from a clean
    database. That is why a past-only date formatter rendering
    "expires -413 days ago" for a 2027 warranty was found by a human on real
    data instead of by anyone running the seed. CLAUDE.md rule 8: seed the edge
    that trips the rule.

    Offsets from today, never fixed dates: a hardcoded 2027 quietly becomes a
    PAST date next year and the case stops being tested at all.
  */
  const dayOffset = (n: number) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const WARRANTY_BY_TAG: Record<string, string> = {
    "TOOL-0001": dayOffset(413), // the exact figure UI-60 and UI-65 report
    "TOOL-0002": dayOffset(515), // the exact figure UI-62 reports
    "TOOL-0003": dayOffset(60), // inside WARRANTY_SOON_DAYS (120) — "ending soon"
    "TOOL-0004": dayOffset(-30), // genuinely expired, so the past branch is covered too
    "TOOL-0005": dayOffset(1), // "tomorrow" — the singular boundary
  };
  /* Two tools whose Code was typed in by a person, not read off a manufacturer
     label — the state `isManualCode` exists to distinguish. Picked because
     both already carry a real `serial` value in the source data, so this
     flags provenance without inventing a code that was never there. */
  const MANUAL_CODE_TAGS = new Set(["TOOL-0001", "TOOL-0002"]);

  const assetRows = await db
    .insert(asset)
    .values(
      assetSpecs.map((a) => ({
        tenantId: tid,
        tag: a.tag,
        modelId: null,
        make: a.make,
        modelNumber: a.modelNumber,
        description: a.description,
        categoryName: categoryFor(a.description),
        serialNumber: a.serial,
        isManualCode: a.tag ? MANUAL_CODE_TAGS.has(a.tag) : false,
        isSerialized: a.isSerialized,
        quantity: a.quantity,
        acquisitionCost: (a.tag ? SEED_COSTS[a.tag] : null) ?? a.cost,
        acquisitionDate: null,
        owningProjectId: a.own ? projectByKey[a.own]! : null,
        costTarget: a.dept ? "department" : "project",
        owningDepartmentId: a.dept ? deptByCode["EQ"]! : null,
        warrantyExpiresOn: (a.tag ? WARRANTY_BY_TAG[a.tag] : null) ?? null,
        currentStatus: a.status,
        currentCustodianId: a.cust ? empByKey[a.cust]! : null,
        currentProjectId: a.cur ? projectByKey[a.cur]! : null,
        currentLocationId: locByKey[locKeyOf(a.tag, a.loc)]!,
        condition: "good",
        createdBy: seedActor.id,
      })),
    )
    .returning();
  /* Untagged tools (UI-68) are deliberately absent from both tag maps: a null
     tag is not a key, and letting two of them collide on one "null" entry would
     hand the assignment and ledger writers below the wrong asset. Nothing
     references them, so skipping is correct rather than merely safe. */
  const assetByTag = Object.fromEntries(assetRows.filter((a) => a.tag).map((a) => [a.tag!, a]));
  // Tag -> spec, so the ledger events below can snapshot the same state the
  // projection was written from. One source of truth for both sides.
  const assetSpecByTag = Object.fromEntries(assetSpecs.filter((a) => a.tag).map((a) => [a.tag!, a]));
  console.log(`[seed] ${assetSpecs.length} assets`);

  // ---- Assignments (active custody). One per tool with a foreman. ----
  const adminId = seedActor.id;
  await db.insert(assignment).values(
    assignSpecs.map((s) => ({
      tenantId: tid,
      assetId: assetByTag[s.tag]!.id,
      custodianId: empByKey[s.cust]!,
      projectId: s.proj ? projectByKey[s.proj]! : null,
      locationId: locByKey[locKeyOf(s.tag, s.loc)]!,
      /* STI-202: when the assignment's location is a trailer's own location
         row, record the trailer first-class too — this is what exercises the
         assignment_trailer_fk composite FK on every reset. TOOL-0001 also
         rides the synthetic truck, so a fresh database carries BOTH of the
         cases criterion 2 keeps distinguishable: "in a truck with a trailer"
         (TOOL-0001) and "in a trailer, affirmatively no truck" (all others —
         honest, because the source sheets carry no trucks at all). */
      truckId: truckIdFor(s.tag),
      trailerId: trailerIdByLocKey[s.loc] ?? null,
      startDate: s.start,
      status: "active",
      approvedBy: adminId,
    })),
  );
  console.log(`[seed] ${assignSpecs.length} assignments`);

  // ---- Transaction log (append-only). One assign event per tool so the
  // activity feed has the tools-list history and the rebuild guarantee holds. ----
  /* Every event carries the complete snapshot (the four core keys, plus the
     explicit STI-202 truck/trailer keys), derived from the same
     assetSpec that set `asset.current_*` above — so the ledger folds to the
     projection by construction. These used to be `toState: null`, which made
     `foldAssetState` a no-op on every seeded asset: `asset.rebuild` reported
     nothing rebuilt and the boot reconciliation sweep raised one
     `custody_discrepancy` per asset (~754) on every fresh reset. Migration 0013
     repaired one database, but its NOT EXISTS guard never re-runs — this is
     what makes the fix survive a reseed (STI-108). A missing key is NOT the
     same as an explicit null: the fold replaces rather than merges, so a
     partial snapshot blanks custodian, project and location on rebuild. */
  await db.insert(transaction).values(
    txSpecs.map((t) => {
      const spec = assetSpecByTag[t.tag]!;
      return {
        tenantId: tid,
        assetId: assetByTag[t.tag]!.id,
        eventType: t.event,
        actorId: adminId,
        /* Genesis import: the state before this event is genuinely unknown, and
           the fold only ever reads toState. Claiming an "available, in the
           warehouse" fromState here would be inventing history. */
        fromState: null,
        toState: {
          status: spec.status,
          custodianId: spec.cust ? empByKey[spec.cust]! : null,
          projectId: spec.cur ? projectByKey[spec.cur]! : null,
          locationId: locByKey[locKeyOf(spec.tag, spec.loc)]!,
          /* STI-202: the seed writes shape-AWARE snapshots — both keys present
             with explicit values, so the fold answers "recorded", not
             "unknown". truckId is an honest null on every source row (the
             sheets have no truck column anywhere, which records "no truck",
             not "never asked"); only TOOL-0001 and TOOL-0003 carry a truck
             (the company-owned and personal-allowance synthetic ones),
             mirroring its assignment row above. A missing key would instead
             fold to "not recorded" — see the shape-boundary rule in
             packages/domain/src/fold.ts. */
          truckId: truckIdFor(spec.tag),
          trailerId: trailerIdByLocKey[spec.loc] ?? null,
        },
        refType: t.ref,
        refId: null,
        occurredAt: new Date(t.at),
        note: t.note,
      };
    }),
  );
  console.log(`[seed] ${txSpecs.length} transactions`);

  /* ---- Desk approval queue (STI-108). ----
     One pending assignment and one pending transfer, both on assets priced at
     or above the highValueThreshold seeded below (5000) — the only assets that
     can produce these rows at runtime. Without them the queue was empty on
     every fresh database, so it could regress to permanently-empty unnoticed;
     the STI-105 developer had to hand-edit rows in psql to see a single one.

     A pending row changes NOTHING yet: no custody link closes, no projection
     moves, no ledger event is written — that all happens at approve time
     (assignment.approve / transfer.approve), which is exactly why seeding
     these directly is safe and mirrors what assignment.create/transfer.create
     write for the `approve` outcome. Custody WRITES still go through
     custody.ts; these rows are paperwork awaiting a second signature. */

  /* Both blocks below name specific tools, foremen, projects and trailers from
     the DEMO dataset. A dataset generated from Urban's own sheets has none of
     those keys, so the lookups resolved to undefined and the insert failed on a
     NOT NULL custodian_id — the queue fixture was silently load-bearing for the
     whole seed. They are skipped when their fixtures are absent: an empty desk
     queue on a real register is correct (nothing has been proposed yet), and
     inventing a pending approval between two real people would be paperwork
     nobody asked for. */
  const deskQueueReady =
    assetByTag["TOOL-0053"] && assetByTag["TOOL-0142"] &&
    empByKey["e-fm005"] && empByKey["e-fm007"] && empByKey["e-fm011"] &&
    projectByKey["p-nex-22017"] && projectByKey["p-garland-22015"] &&
    projectByKey["p-dart-20011"] &&
    locByKey["l-TE-011"] && locByKey["l-TE-013"] && locByKey["l-TE-017"];

  if (!deskQueueReady) {
    console.log("[seed] desk approval queue skipped — this dataset has none of its fixtures");
  } else {
  // TOOL-0053 (HONDA EB6500X, exactly $5000.00 — the `>=` edge) is held by
  // Jose Luis Rodriguez; the desk proposed moving it to Andres Flores (NEX).
  await db.insert(assignment).values({
    tenantId: tid,
    assetId: assetByTag["TOOL-0053"]!.id,
    custodianId: empByKey["e-fm005"]!,
    projectId: projectByKey["p-nex-22017"]!,
    locationId: locByKey["l-TE-011"]!,
    trailerId: trailerIdByLocKey["l-TE-011"] ?? null,
    /* The PERSONAL-allowance truck, deliberately (STI-206). The approval queue
       marks a personal truck so the desk can see it is signing company property
       onto someone's own vehicle — the distinction the departure path keys off.
       Without a pending row that carries one, that marker was unreachable from
       a clean database and nobody could have seen it work. */
    truckId: seedPersonalTruckId,
    startDate: TODAY,
    status: "pending_approval",
    approvedBy: null,
  });

  // TOOL-0142 (HONDA EB6500X, $5200 — above threshold) is held by Alberto
  // Mendes Aleman on Garland; a hand-off to Felipe Portillo (DART) waits.
  // It names the destination rig (STI-203 / 0017): the trailer the tool would
  // ride to DART in. Held-with-a-rig is now a reachable state, so the seed
  // reaches it — approving this row exercises the parked columns and their
  // composite FKs from a fresh reset, not just the direct path.
  await db.insert(transfer).values({
    tenantId: tid,
    assetId: assetByTag["TOOL-0142"]!.id,
    fromCustodianId: empByKey["e-fm007"]!,
    toCustodianId: empByKey["e-fm011"]!,
    fromLocationId: locByKey["l-TE-013"]!,
    toLocationId: locByKey["l-TE-017"]!,
    fromProjectId: projectByKey["p-garland-22015"]!,
    toProjectId: projectByKey["p-dart-20011"]!,
    toTruckId: null, // no truck in the fleet data; the synthetic truck stays on TOOL-0001
    toTrailerId: trailerIdByLocKey["l-TE-017"] ?? null,
    reason: "reallocation",
    status: "pending_approval",
    requestedBy: adminId,
    approvedBy: null,
  });
    console.log("[seed] 1 pending assignment + 1 pending transfer (desk queue)");
  }

  // ---- Tenant settings ----
  await db.insert(tenantSettings).values({
    tenantId: tid,
    highValueThreshold: 5000,
    custodyApproverRole: "equipment_admin",
    overdueEscalateAfterDays: 3,
    missingReviewSlaDays: 7,
    discrepancyReviewSlaDays: 2,
    emailEnabled: true,
    smsEnabled: false,
  });

  /*
    Feature states seeded from a clean database rather than only reachable by
    hand-editing a row (CLAUDE.md rule 9) — and, for `old-dashboard`, because
    STI-1204's own acceptance criteria says so directly: "seed a tenant with
    at least one module disabled. A setting no seeded data exercises is a
    setting nobody tests."

    - `import.ai` upcoming is the state the AI Import button actually ships in.
    - `activity` beta exercises the nav-badge path on a real row.
    - `old-dashboard` hidden is the real disabled-module case: `/old-dash` is
      the widget dashboard `/home` replaced on 2026-08-23, kept only "until
      this one has been lived with" (see nav-config.ts) — the safest real
      candidate to demonstrate hiding without removing anything anyone
      still depends on.
    - `settings-general` hidden proves the one thing that must never work:
      Settings is exempt from hiding regardless of what a row here says. If
      this ever starts hiding the General settings row, the exemption in
      `applyFeatureStates` broke.
  */
  await db.insert(tenantFeature).values([
    { tenantId: tid, key: "import.ai", state: "upcoming" },
    { tenantId: tid, key: "activity", state: "beta" },
    { tenantId: tid, key: "old-dashboard", state: "hidden" },
    { tenantId: tid, key: "settings-general", state: "hidden" },
  ]);

  // ---- Messaging: Equipment Department channel ----
  const [channelRow] = await db
    .insert(channel)
    .values({
      tenantId: tid,
      name: "Equipment Department",
      slug: "equipment-department",
      kind: "department",
      memberRole: "equipment_admin",
    })
    .returning();
  console.log("[seed] 1 channel");

  /*
    The inbox, with something actually in it.

    Until now the seed created a channel and then nothing to put in it: no
    messages and no tasks on any machine in the project. That made all three
    inbox buckets permanently empty, so Dismiss, Try again and Decline were
    never clickable without hand-made rows — and UI-72 is exactly what that
    costs. Two defects shipped in the dismiss path (copy written for a different
    button, and a dismissed MESSAGE falling out of every bucket) because nobody
    could reach the screen to look at it.

    That is CLAUDE.md rule 8: data the seed cannot produce is behaviour nobody
    tests. So each bucket the inbox renders gets a row that lands in it.

    `pending_manual` and `error` are the Unrecognized bucket; `action_proposed`
    and a `pending` task with an `actionType` are the Recognized one; the
    executed message is history. Statuses are written directly rather than by
    running the worker, because the parse needs a model and the seed must work
    with no LLM configured at all.
  */
  const deskUserId = seedActor.id;
  const foremanEmpId = empByKey["e-fm001"]!;
  const repairAsset = assetByTag["TOOL-0004"]!;

  await db.insert(message).values([
    {
      tenantId: tid,
      channelId: channelRow!.id,
      authorEmployeeId: foremanEmpId,
      body: "the little green one is acting up again",
      /* Nothing resolvable in it — no tag, no verb the catalog knows. This is
         the shape the desk has to settle by hand, and the shape Dismiss exists
         for. */
      processingStatus: "pending_manual",
      attempts: 4,
      errorNote: "No tool could be resolved from this message.",
    },
    {
      tenantId: tid,
      channelId: channelRow!.id,
      authorEmployeeId: foremanEmpId,
      body: "TOOL-0004 needs a new blade",
      /* Reached the parser and failed there, which is the retryable half of
         Unrecognized — this is the row that makes "Try again" reachable. */
      processingStatus: "error",
      attempts: 2,
      errorNote: "The language model was unreachable.",
    },
    {
      tenantId: tid,
      channelId: channelRow!.id,
      authorEmployeeId: foremanEmpId,
      body: "sending TOOL-0004 in for repair",
      /* Parsed, understood, and waiting for a second signature. */
      processingStatus: "action_proposed",
      intentType: "repair",
      proposedAction: { type: "repair", assetIds: [repairAsset.id] },
    },
    {
      tenantId: tid,
      channelId: channelRow!.id,
      authorEmployeeId: foremanEmpId,
      body: "TOOL-0003 back in the yard",
      /* History — the Completed bucket needs an occupant too, or "signed off"
         is another state nobody has ever seen rendered. */
      processingStatus: "action_executed",
      intentType: "return",
      handledByUserId: deskUserId,
      handledAt: new Date(),
    },
  ]);

  await db.insert(task).values([
    {
      tenantId: tid,
      title: "Repair requested: TOOL-0004",
      description: "Blade is worn through. Raised from the yard by the foreman.",
      status: "pending",
      priority: "high",
      assignedToEmployeeId: foremanEmpId,
      createdByUserId: deskUserId,
      relatedAssetId: repairAsset.id,
      source: "chat",
      /* `actionType` is what makes this ACTIONABLE rather than prose: the inbox
         only offers Decline (and, when it is wired, Approve) on a task that
         carries the verb it would replay. A task without it is a sentence the
         desk can read and not act on. */
      actionType: "repair",
      pendingAction: { type: "repair", assetIds: [repairAsset.id] },
    },
    {
      tenantId: tid,
      title: "Tag the two unlabelled tools in the Dallas yard",
      description: "Both came in without a label. They are on the Needs a Tag report.",
      status: "completed",
      priority: "low",
      createdByUserId: deskUserId,
      source: "manual",
    },
  ]);
  console.log("[seed] 4 messages + 2 tasks — every inbox bucket has an occupant");

  console.log(`
[seed] DONE.

${USE_URBAN
  ? `Login — ONE account, the system owner:

  ${userRows[0]?.email ?? "(no account seeded)"}
  password: ${generatedPassword
      ? `${generatedPassword}      <-- GENERATED, shown once. Save it now.`
      : "(taken from SEED_OWNER_PASSWORD)"}

No demo accounts were created. Add colleagues through /admin/users, each with
their own password.`
  : `Login — password  stinventory-demo  for every account (STI-304).
One per role, because a permission system only ever tested as 'owner'
is not a tested permission system. See docs/SETUP.md.

This is the DEMO fixture, not a real register. e2e/roles.ts and the login
page's one-click accounts both depend on that password, and rbac-matrix.test.ts
drives the visibility ladder through these accounts. For Urban's real data:
SEED_DATASET=urban`}
`);
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await client.end();
  } catch {}
  process.exit(1);
});
