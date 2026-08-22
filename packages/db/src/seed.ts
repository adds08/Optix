import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { PERMISSIONS, ROLES } from "@stinventory/types";
import * as schema from "./schema/index.js";
import { ROLE_PERMS } from "./role-perms.js";
import {
  asset,
  assignment,
  channel,
  department,
  employee,
  employeeProjectAssignment,
  location,
  permission,
  project,
  projectTeamMember,
  role,
  rolePermission,
  tenant,
  tenantSettings,
  transaction,
  transfer,
  user,
  userRole,
  vehicle,
  warehouse,
} from "./schema/index.js";
import {
  assetSpecs,
  assignSpecs,
  departmentSpecs,
  employeeSpecs,
  locSpecs,
  postingSpecs,
  projectSpecs,
  teamSpecs,
  txSpecs,
  userSpecs,
  vehLocSpecs,
  vehSpecs,
} from "./seed-data.js";

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
      await tx.execute(sql`ALTER TABLE "transaction" DISABLE TRIGGER transaction_no_update_delete`);
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
      await tx.delete(tenant);
      await tx.execute(sql`ALTER TABLE "transaction" ENABLE TRIGGER transaction_no_update_delete`);
    });
  }

  /*
    Demo logins must never exist on a production database.

    This seed creates five accounts with the password `stinventory-demo`,
    including an owner with every permission. That is exactly right for a demo
    and catastrophic on a real deployment — and "we will remember not to run
    it" is not a control.
  */
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
    console.error(
      "[seed] refusing to run with NODE_ENV=production — this creates demo logins " +
        "with a published password. Set SEED_ALLOW_PRODUCTION=1 only if you are certain.",
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
    .values({ name: "Urban Infraconstruction", slug: "urban" })
    .returning();
  if (!t) throw new Error("tenant insert failed");
  const tid = t.id;
  console.log(`[seed] tenant ${t.slug}`);

  // ---- Permissions + roles ----
  await db.insert(permission).values(PERMISSIONS.map((name) => ({ name }))).onConflictDoNothing();
  const roles = await db.insert(role).values(ROLES.map((name) => ({ tenantId: tid, name }))).returning();
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

  // ---- Employees (domain persons; custody holders) ----
  // Insert projects first (employees reference primaryProjectId).
  const projectRows = await db
    .insert(project)
    .values(
      projectSpecs.map((p) => ({
        tenantId: tid,
        externalId: p.extId,
        name: p.name,
        status: p.status,
        costCenter: p.costCenter,
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
      })),
    )
    .returning();
  const empByKey: Record<string, string> = {};
  employeeSpecs.forEach((e, i) => (empByKey[e.key] = employeeRows[i]!.id));

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
  const passwordHash = await bcrypt.hash("stinventory-demo", 10);
  const userRows = await db
    .insert(user)
    .values(
      userSpecs.map((u) => ({
        tenantId: tid,
        employeeId: u.employeeKey ? empByKey[u.employeeKey]! : null,
        email: u.email,
        passwordHash,
        firstName: u.first,
        lastName: u.last,
        /* Defaults to active; one seeded account is deactivated so STI-303's
           Deactivated badge and Reactivate button are reachable from a clean
           database. */
        isActive: u.isActive ?? true,
      })),
    )
    .returning();
  const userByEmail = Object.fromEntries(userRows.map((u) => [u.email, u]));
  for (const u of userRows) {
    const spec = userSpecs.find((s) => s.email === u.email)!;
    await db.insert(userRole).values({ userId: u.id, roleId: roleByName[spec.role]!.id });
  }
  console.log(`[seed] ${userRows.length} users, ${employeeRows.length} employees`);

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
      unit: v.unit,
      plate: v.plate,
      makeModel: v.make,
      ownershipType: v.own,
      payeeEmployeeId: v.payee ? empByKey[v.payee]! : null,
      allowanceRate: v.allow ?? null,
      allowanceFrequency: v.freq ?? null,
      gpsLat: v.lat,
      gpsLng: v.lng,
      gpsAt: new Date(TODAY),
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
  const seedPersonalTruckId = vehicleRows[vehSpecs.findIndex((v) => v.own === "personal_allowance")]!.id;
  const personalTruckTag =
    assignSpecs.find((s) => s.tag !== "TOOL-0001" && s.tag !== modelCorrectTag)?.tag ?? null;
  const truckIdFor = (tag: string) =>
    tag === "TOOL-0001" ? seedTruckId : tag === personalTruckTag ? seedPersonalTruckId : null;
  const YARD_LOC_KEY = "l-dal";
  /* The location the three writers below agree on. `trailerId` deliberately
     keeps using the ORIGINAL key — that is the whole point: the trailer is
     still recorded, the location no longer names it. */
  const locKeyOf = (tag: string, loc: string) => (tag === modelCorrectTag ? YARD_LOC_KEY : loc);
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
        categoryName: null,
        serialNumber: a.serial,
        isSerialized: a.isSerialized,
        quantity: a.quantity,
        acquisitionCost: SEED_COSTS[a.tag] ?? a.cost,
        acquisitionDate: null,
        owningProjectId: a.own ? projectByKey[a.own]! : null,
        costTarget: a.dept ? "department" : "project",
        owningDepartmentId: a.dept ? deptByCode["EQ"]! : null,
        warrantyExpiresOn: WARRANTY_BY_TAG[a.tag] ?? null,
        currentStatus: a.status,
        currentCustodianId: a.cust ? empByKey[a.cust]! : null,
        currentProjectId: a.cur ? projectByKey[a.cur]! : null,
        currentLocationId: locByKey[locKeyOf(a.tag, a.loc)]!,
        condition: "good",
        createdBy: userByEmail["admin@stinventory.local"]!.id,
      })),
    )
    .returning();
  const assetByTag = Object.fromEntries(assetRows.map((a) => [a.tag, a]));
  // Tag -> spec, so the ledger events below can snapshot the same state the
  // projection was written from. One source of truth for both sides.
  const assetSpecByTag = Object.fromEntries(assetSpecs.map((a) => [a.tag, a]));
  console.log(`[seed] ${assetSpecs.length} assets`);

  // ---- Assignments (active custody). One per tool with a foreman. ----
  const adminId = userByEmail["admin@stinventory.local"]!.id;
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

  // ---- Messaging: Equipment Department channel ----
  await db.insert(channel).values({
    tenantId: tid,
    name: "Equipment Department",
    slug: "equipment-department",
    kind: "department",
    memberRole: "equipment_admin",
  });
  console.log("[seed] 1 channel");

  console.log(`
[seed] DONE.

Login — password  stinventory-demo  for every account (STI-304).
One per role, because a permission system only ever tested as 'owner'
is not a tested permission system. See docs/SETUP.md.

  owner@stinventory.local        Demo Owner      System Administrator — everything
  admin@stinventory.local        Karen Osei      Equipment Administrator
  office@stinventory.local       Lena Boyd       Office Administrator — no custody, no config
  warehouse@stinventory.local    Yard Desk       Warehouse — the yard desk
  pm@stinventory.local           Dana Whitmore   Project Manager — Lone Star only
  engineer@stinventory.local     Priya Raman     Engineer — DART only
  super@stinventory.local        Marcus Whitfield Superintendent — his crew, across two jobs
  foreman@stinventory.local      Alejandro Capuchino  Foreman — his own tools only
  mechanic@stinventory.local     Ruben Ortiz     Mechanic — his own tools, charged to the department
  procurement@stinventory.local  Nadia Kerr      Procurement
  hr@stinventory.local           Tomas Reyes     HR — people, deliberately NOT tools
  finance@stinventory.local      Grace Lin       Finance
  readonly@stinventory.local     Read Only       Read-only
  jobani@stinventory.local       Jobani Abarca   DEACTIVATED — cannot sign in, by design

Visibility (STI-302) — the ladder, on this data:
  owner/admin/office/warehouse/hr/finance/procurement/readonly  every tool
  pm        -> the tools on Lone Star
  engineer  -> the tools on DART
  super     -> the tools his crew hold, which spans Lone Star and DART
  foreman   -> the ${assignSpecs.filter((a) => a.cust === "e-fm001").length} tools in his own hands
  mechanic  -> the ${assignSpecs.filter((a) => a.cust === "e-mech001").length} shop tools in his

Data (from TOOL LIST BY NAME.xlsx):
  ${employeeRows.length} people, ${projectRows.length} projects,
  ${trailerCount} trailers (+2 synthetic trucks, seed-only), ${assetRows.length} tools
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
