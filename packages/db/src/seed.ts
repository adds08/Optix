import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { PERMISSIONS, ROLES } from "@stinventory/types";
import * as schema from "./schema/index.js";
import {
  asset,
  assetModel,
  assignment,
  category,
  channel,
  department,
  employee,
  employeeProjectAssignment,
  location,
  manufacturer,
  notification,
  permission,
  project,
  role,
  rolePermission,
  tenant,
  tenantSettings,
  transaction,
  user,
  userRole,
  vehicle,
  warehouse,
} from "./schema/index.js";

const url = process.env.DATABASE_URL ?? "postgres://postgres:stinventory@localhost:5433/stinventory";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

// Fixed "today" for deterministic overdue detection (matches the prototype).
const TODAY = "2026-07-09";

// RBAC: permissions per role (MVP subset). owner/equipment_admin broad; foreman narrow.
const ROLE_PERMS: Record<(typeof ROLES)[number], readonly string[]> = {
  owner: [...PERMISSIONS],
  equipment_admin: [...PERMISSIONS],
  warehouse: [
    "asset.read",
    "asset.manage",
    "department.read",
    "location.read",
    "location.manage",
    "vehicle.read",
    "vehicle.manage",
    "project.read",
    "employee.read",
    "assignment.read",
    "assignment.create",
    "rental.read",
    "transfer.read",
    "transfer.create",
    "report.read",
    "notification.read",
    "notification.manage",
  ],
  superintendent: [
    "asset.read", "location.read", "vehicle.read", "project.read", "employee.read",
    "assignment.read", "assignment.create", "assignment.approve",
    "transfer.read", "transfer.create", "transfer.approve",
    "report.read", "notification.read",
  ],
  procurement: ["asset.read", "project.read", "employee.read", "report.read"],
  project_manager: ["asset.read", "project.read", "project.manage", "employee.read", "report.read"],
  foreman: [
    "asset.read",
    "location.read",
    "vehicle.read",
    "project.read",
    "employee.read",
    "assignment.read",
    "assignment.create",
    "transfer.read",
    "transfer.create",
    "report.read",
    "notification.read",
  ],
  hr: ["employee.read", "employee.manage", "notification.read", "report.read"],
  finance: ["asset.read", "project.read", "report.read", "audit.read"],
  read_only: ["asset.read", "location.read", "vehicle.read", "project.read", "employee.read", "report.read"],
};

async function main() {
  console.log("[seed] target:", url.replace(/:[^@]+@/, ":***@"));

  if (process.env.SEED_RESET === "1") {
    console.log("[seed] SEED_RESET=1 — wiping data first");
    await db.delete(asset);
    await db.delete(transaction);
    await db.delete(notification);
    await db.delete(vehicle);
    await db.delete(location);
    await db.delete(employeeProjectAssignment); // before employees — it points at them
    await db.delete(employee);
    await db.delete(project);
    await db.delete(warehouse);
    await db.delete(assetModel);
    await db.delete(category);
    await db.delete(manufacturer);
    await db.delete(userRole);
    await db.delete(rolePermission);
    await db.delete(role);
    await db.delete(user);
    await db.delete(permission);
    await db.delete(tenantSettings);
    await db.delete(tenant);
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
  /* The one department every tenant needs on day one: the shop's tools are not
     on any job, and they still have to be charged to something. */
  const [dept] = await db
    .insert(department)
    .values({ tenantId: tid, name: "Repair & Maintenance", code: "RM", isActive: true })
    .returning();
  const deptRm = dept!.id;

  // ---- Employees (domain persons; custody holders) ----
  // Insert projects first (employees reference primaryProjectId).
  const projectSpecs = [
    { key: "p-legacy", extId: "URB-2401", name: "Legacy West Phase 3", status: "active", costCenter: "CC-4100", start: "2026-01-06", end: "2026-11-30", site: "7501 Windrose Ave, Plano TX 75024" },
    { key: "p-trinity", extId: "URB-2402", name: "Trinity Bridge Rehab", status: "active", costCenter: "CC-4210", start: "2026-03-02", end: "2027-02-15", site: "Sylvan Ave at Trinity Levee, Dallas TX 75207" },
    { key: "p-gpk", extId: "URB-2403", name: "Grand Parkway Segment H", status: "active", costCenter: "CC-4315", start: "2026-02-10", end: "2026-12-20", site: "TX-99 at Morton Rd, Katy TX 77493" },
    { key: "p-uptown", extId: "URB-2398", name: "Uptown Utility Relocate", status: "closing", costCenter: "CC-3980", start: "2025-08-01", end: "2026-07-31", site: "2300 McKinney Ave, Dallas TX 75201" },
    { key: "p-warehouse", extId: "URB-YARD", name: "Equipment Yard (unassigned)", status: "active", costCenter: "CC-0000", start: "2025-01-01", end: "2030-01-01", site: "1400 S Lamar St, Dallas TX 75215" },
  ];
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

  const employeeSpecs = [
    { key: "e-carlos", extId: "5519", name: "Carlos Mendez", role: "superintendent", primary: "p-legacy", status: "active", email: "carlos.mendez@urban.local", phone: "214-555-0115", reportsTo: null },
    { key: "e-miguel", extId: "8821", name: "Miguel Torres", role: "foreman", primary: "p-legacy", status: "active", email: "miguel.torres@urban.local", phone: "214-555-0110", reportsTo: "e-carlos" },
    { key: "e-dwayne", extId: "4417", name: "Dwayne Ellis", role: "foreman", primary: "p-trinity", status: "active", email: "dwayne.ellis@urban.local", phone: "214-555-0111", reportsTo: "e-carlos" },
    { key: "e-sofia", extId: "5592", name: "Sofia Ramirez", role: "foreman", primary: "p-gpk", status: "active", email: "sofia.ramirez@urban.local", phone: "214-555-0112", reportsTo: null },
    { key: "e-james", extId: "3308", name: "James Whitaker", role: "foreman", primary: "p-uptown", status: "terminated", email: "james.whitaker@urban.local", phone: "214-555-0113", reportsTo: null },
    { key: "e-karen", extId: "0199", name: "Karen Osei", role: "equipment_admin", primary: null, status: "active", email: "karen.osei@urban.local", phone: "214-555-0100", reportsTo: null },
    { key: "e-yard", extId: "7712", name: "Yard Desk", role: "warehouse", primary: null, status: "active", email: "yard@urban.local", phone: "214-555-0199", reportsTo: null },
    /* Shop staff: a custodian who can hold tools but is not on any job. The
       tools they hold get charged to Repair & Maintenance. */
    { key: "e-dave", extId: "3904", name: "Dave Kowalski", role: "mechanic", primary: null, status: "active", email: "dave.kowalski@urban.local", phone: "214-555-0166", reportsTo: null },
  ];
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

  // Two-pass: update reportsToEmployeeId for foremen after all employees are inserted.
  for (const e of employeeSpecs) {
    if (e.reportsTo && empByKey[e.reportsTo]) {
      await db
        .update(employee)
        .set({ reportsToEmployeeId: empByKey[e.reportsTo] })
        .where(eq(employee.id, empByKey[e.key]!));
    }
  }

  // ---- Job postings ----
  // The backtrack behind "tools follow the foreman". Dwayne carries a closed
  // posting as well as an open one, so the history screen has something real to
  // show: Uptown stalled, he moved to Trinity, and his trailer went with him.
  const postingSpecs = [
    { emp: "e-carlos", proj: "p-legacy", from: "2026-01-06", to: null, note: "Initial posting" },
    { emp: "e-miguel", proj: "p-legacy", from: "2026-01-06", to: null, note: "Initial posting" },
    { emp: "e-dwayne", proj: "p-uptown", from: "2026-01-06", to: "2026-05-18", note: "Initial posting" },
    { emp: "e-dwayne", proj: "p-trinity", from: "2026-05-18", to: null, note: "Uptown paused — moved with his trailer" },
    { emp: "e-sofia", proj: "p-gpk", from: "2026-02-02", to: null, note: "Initial posting" },
    { emp: "e-james", proj: "p-uptown", from: "2026-01-06", to: null, note: "Initial posting" },
  ];
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

  // ---- Login users ----
  const passwordHash = await bcrypt.hash("stinventory-demo", 10);
  const userSpecs = [
    { email: "owner@stinventory.local", first: "Demo", last: "Owner", role: "owner", employeeKey: null },
    { email: "admin@stinventory.local", first: "Karen", last: "Osei", role: "equipment_admin", employeeKey: "e-karen" },
    { email: "warehouse@stinventory.local", first: "Yard", last: "Desk", role: "warehouse", employeeKey: "e-yard" },
    { email: "foreman.miguel@stinventory.local", first: "Miguel", last: "Torres", role: "foreman", employeeKey: "e-miguel" },
    { email: "super.carlos@stinventory.local", first: "Carlos", last: "Mendez", role: "superintendent", employeeKey: "e-carlos" },
  ];
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
      })),
    )
    .returning();
  const userByEmail = Object.fromEntries(userRows.map((u) => [u.email, u]));
  for (const u of userRows) {
    const spec = userSpecs.find((s) => s.email === u.email)!;
    await db.insert(userRole).values({ userId: u.id, roleId: roleByName[spec.role]!.id });
  }
  console.log(`[seed] ${userRows.length} users, ${employeeRows.length} employees`);

  // ---- Catalog: categories, manufacturers, models ----
  const catSpecs = ["Power Tools", "Power Equipment", "Hand Tools", "Survey", "Concrete", "Access", "Safety"];
  const catRows = await db
    .insert(category)
    .values(catSpecs.map((name) => ({ tenantId: tid, name })))
    .returning();
  const catByName = Object.fromEntries(catRows.map((c) => [c.name, c.id]));

  const mfrSpecs = ["Hilti", "DeWalt", "Honda", "Trimble", "Milwaukee", "Wacker Neuson", "Stihl", "Bosch", "Genie", "Makita", "Topcon"];
  const mfrRows = await db
    .insert(manufacturer)
    .values(mfrSpecs.map((name) => ({ tenantId: tid, name })))
    .returning();
  const mfrByName = Object.fromEntries(mfrRows.map((m) => [m.name, m.id]));

  type ModelSpec = { name: string; mfr: string; cat: string; cost: string; serialized: boolean };
  const modelSpecs: ModelSpec[] = [
    { name: "TE 60-ATC Rotary Hammer", mfr: "Hilti", cat: "Power Tools", cost: "1650", serialized: true },
    { name: "DWS779 Miter Saw", mfr: "DeWalt", cat: "Power Tools", cost: "640", serialized: true },
    { name: "EU7000is Generator", mfr: "Honda", cat: "Power Equipment", cost: "4600", serialized: true },
    { name: "R12i GNSS Receiver", mfr: "Trimble", cat: "Survey", cost: "21500", serialized: true },
    { name: "M18 Impact Kit", mfr: "Milwaukee", cat: "Power Tools", cost: "380", serialized: true },
    { name: "Plate Compactor", mfr: "Wacker Neuson", cat: "Concrete", cost: "2100", serialized: true },
    { name: "PM 40-MG Laser Level", mfr: "Hilti", cat: "Survey", cost: "720", serialized: true },
    { name: "TS 500i Cut-Off Saw", mfr: "Stihl", cat: "Power Tools", cost: "1150", serialized: true },
    { name: "20V Drill/Driver Kit", mfr: "DeWalt", cat: "Power Tools", cost: "260", serialized: true },
    { name: "GLL3-330C Laser Level", mfr: "Bosch", cat: "Survey", cost: "480", serialized: true },
    { name: "AWP-30S Personnel Lift", mfr: "Genie", cat: "Access", cost: "8900", serialized: true },
    { name: "DX 6 Powder Fastener", mfr: "Hilti", cat: "Power Tools", cost: "1350", serialized: true },
    { name: "EK7651H Power Cutter", mfr: "Makita", cat: "Power Tools", cost: "890", serialized: true },
    { name: "GT-1200 Robotic Total Station", mfr: "Topcon", cat: "Survey", cost: "33000", serialized: true },
    { name: "M18 5.0Ah Battery (box of 6)", mfr: "Milwaukee", cat: "Power Tools", cost: "420", serialized: false },
  ];
  const modelRows = await db
    .insert(assetModel)
    .values(
      modelSpecs.map((m) => ({
        tenantId: tid,
        manufacturerId: mfrByName[m.mfr]!,
        name: m.name,
        categoryId: catByName[m.cat]!,
        defaultUnitCost: m.cost,
        isSerialized: m.serialized,
      })),
    )
    .returning();
  const modelByName = Object.fromEntries(modelRows.map((m) => [m.name, m.id]));

  // ---- Warehouses + locations + vehicles ----
  const whRows = await db
    .insert(warehouse)
    .values([
      { tenantId: tid, name: "Main Warehouse — Dallas", region: "TX-North", address: "Dallas, TX" },
      { tenantId: tid, name: "Regional Warehouse — Houston", region: "TX-Gulf", address: "Houston, TX" },
    ])
    .returning();
  const whByName = Object.fromEntries(whRows.map((w) => [w.name, w.id]));

  // Non-vehicle locations.
  // `custodian` = who carries this container. A yard carries itself; a gang box
  // rides with whoever loaded it, which is why it has a person and a warehouse
  // does not.
  const locSpecs = [
    { key: "l-dal", type: "warehouse", name: "Dallas Yard", warehouse: "Main Warehouse — Dallas", project: null, custodian: null },
    { key: "l-hou", type: "warehouse", name: "Houston Yard", warehouse: "Regional Warehouse — Houston", project: null, custodian: null },
    { key: "l-gbA", type: "gang_box", name: "Gang Box A", warehouse: null, project: "p-legacy", custodian: "e-miguel" },
    { key: "l-contH", type: "site_container", name: "Container — GPK H", warehouse: null, project: "p-gpk", custodian: "e-sofia" },
    { key: "l-contU", type: "site_container", name: "Container — Uptown", warehouse: null, project: "p-uptown", custodian: "e-james" },
  ];
  // Vehicle locations (one location row per truck/trailer, type=vehicle).
  // `custodian` mirrors the vehicle's foreman below — the location column is the
  // authoritative one.
  const vehLocSpecs = [
    { key: "l-t07", type: "vehicle", name: "Truck 07", project: "p-legacy", custodian: "e-miguel" },
    { key: "l-tr21", type: "vehicle", name: "Trailer 21", project: "p-legacy", custodian: "e-miguel" },
    { key: "l-truck12", type: "vehicle", name: "Truck 12", project: "p-trinity", custodian: "e-dwayne" },
    { key: "l-tr08", type: "vehicle", name: "Trailer 08", project: "p-trinity", custodian: "e-dwayne" },
    { key: "l-t15", type: "vehicle", name: "Truck 15", project: "p-gpk", custodian: "e-sofia" },
    { key: "l-tr33", type: "vehicle", name: "Trailer 33", project: "p-gpk", custodian: "e-sofia" },
    { key: "l-t04", type: "vehicle", name: "Truck 04", project: "p-uptown", custodian: "e-james" },
  ];
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

  /* The hitch: a trailer's location points at its truck's location. Seeded so
     the demo shows the relationship the system now models — a trailer moves
     with the truck it is attached to. */
  const hitches: Record<string, string> = {
    "l-tr21": "l-t07",
    "l-tr08": "l-truck12",
    "l-tr33": "l-t15",
  };
  for (const [trailerKey, truckKey] of Object.entries(hitches)) {
    await db
      .update(location)
      .set({ parentLocationId: locByKey[truckKey]! })
      .where(eq(location.id, locByKey[trailerKey]!));
  }

  // Vehicles (1:1 with vehicle locations). GPS seeded for the Dallas area.
  const vehSpecs = [
    { key: "v-t07", loc: "l-t07", vtype: "truck", unit: "TRU-001", plate: "TX 5521-BR", make: "RAM 2500", own: "personal_allowance", payee: "e-miguel", allow: "180.00", freq: "weekly", proj: "p-legacy", foreman: "e-miguel", lat: "32.7766", lng: "-96.7970" },
    { key: "v-tr21", loc: "l-tr21", vtype: "trailer", unit: "TRA-001", plate: "TX TR-2210", make: "PJ 20ft Equipment", own: "company_owned", payee: null, proj: "p-legacy", foreman: "e-miguel", lat: "32.7766", lng: "-96.7971" },
    { key: "v-t12", loc: "l-truck12", vtype: "truck", unit: "TRU-002", plate: "TX 8842-KL", make: "Ford F-350", own: "company_owned", payee: null, proj: "p-trinity", foreman: "e-dwayne", lat: "32.7800", lng: "-96.8050" },
    { key: "v-tr08", loc: "l-tr08", vtype: "trailer", unit: "TRA-002", plate: "TX TR-0817", make: "Big Tex 14ft Dump", own: "company_owned", payee: null, proj: "p-trinity", foreman: "e-dwayne", lat: "32.7800", lng: "-96.8051" },
    { key: "v-t15", loc: "l-t15", vtype: "truck", unit: "TRU-003", plate: "TX 9930-MN", make: "Chevy Silverado 3500", own: "company_owned", payee: null, proj: "p-gpk", foreman: "e-sofia", lat: "29.7604", lng: "-95.3698" },
    { key: "v-tr33", loc: "l-tr33", vtype: "trailer", unit: "TRA-003", plate: "TX TR-3390", make: "Load Trail Gooseneck", own: "company_owned", payee: null, proj: "p-gpk", foreman: "e-sofia", lat: "29.7604", lng: "-95.3699" },
    { key: "v-t04", loc: "l-t04", vtype: "truck", unit: "TRU-004", plate: "TX 3310-UP", make: "Ford F-250", own: "company_owned", payee: null, proj: "p-uptown", foreman: "e-james", lat: "32.8500", lng: "-96.8500" },
  ];
  await db.insert(vehicle).values(
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
      projectId: projectByKey[v.proj]!,
      foremanEmployeeId: empByKey[v.foreman]!,
    })),
  );
  console.log(`[seed] ${vehSpecs.length} vehicles`);

  // ---- Assets (the register). current_* projection set at seed time; matching
  // transactions are appended below so the rebuild guarantee holds.
  // `make`/`modelNumber`/`description` are the flat columns Urban's sheets use;
  // `model` is the model-spec name for the vestigial asset_model link.
  type AssetSpec = {
    tag: string; model: string; make: string; modelNumber: string | null; description: string;
    serial: string; cost: string; acquired: string;
    own: string | null; status: string; cust: string | null; cur: string | null; loc: string;
    cond: string; warranty: string; dept: boolean;
  };
  const assetSpecs: AssetSpec[] = [
    { tag: "UIC-1001", model: "TE 60-ATC Rotary Hammer", make: "Hilti", modelNumber: "TE 60-ATC", description: "Rotary Hammer", serial: "H60-88213", cost: "1650", acquired: "2025-04-11", own: "p-legacy", status: "assigned", cust: "e-miguel", cur: "p-legacy", loc: "l-gbA", cond: "good", warranty: "2027-04-11", dept: false },
    { tag: "UIC-1002", model: "DWS779 Miter Saw", make: "DeWalt", modelNumber: "DWS779", description: "Miter Saw", serial: "DW-42119", cost: "640", acquired: "2025-06-02", own: "p-legacy", status: "assigned", cust: "e-miguel", cur: "p-legacy", loc: "l-gbA", cond: "good", warranty: "2027-06-02", dept: false },
    { tag: "UIC-1003", model: "EU7000is Generator", make: "Honda", modelNumber: "EU7000is", description: "Generator", serial: "HG-77341", cost: "4600", acquired: "2024-11-20", own: "p-trinity", status: "assigned", cust: "e-dwayne", cur: "p-trinity", loc: "l-truck12", cond: "good", warranty: "2026-11-20", dept: false },
    { tag: "UIC-1004", model: "R12i GNSS Receiver", make: "Trimble", modelNumber: "R12i", description: "GNSS Receiver", serial: "TR-10093", cost: "21500", acquired: "2025-01-15", own: "p-gpk", status: "assigned", cust: "e-sofia", cur: "p-gpk", loc: "l-contH", cond: "good", warranty: "2028-01-15", dept: false },
    { tag: "UIC-1005", model: "M18 Impact Kit", make: "Milwaukee", modelNumber: "M18", description: "Impact Kit", serial: "MW-55210", cost: "380", acquired: "2025-09-01", own: "p-gpk", status: "assigned", cust: "e-sofia", cur: "p-gpk", loc: "l-contH", cond: "fair", warranty: "2027-09-01", dept: false },
    { tag: "UIC-1006", model: "Plate Compactor", make: "Wacker Neuson", modelNumber: null, description: "Plate Compactor", serial: "WN-33027", cost: "2100", acquired: "2024-08-19", own: "p-uptown", status: "assigned", cust: "e-james", cur: "p-uptown", loc: "l-contU", cond: "fair", warranty: "2026-08-19", dept: false },
    { tag: "UIC-1007", model: "PM 40-MG Laser Level", make: "Hilti", modelNumber: "PM 40-MG", description: "Laser Level", serial: "HL-19022", cost: "720", acquired: "2025-03-30", own: "p-uptown", status: "assigned", cust: "e-james", cur: "p-uptown", loc: "l-contU", cond: "good", warranty: "2027-03-30", dept: false },
    { tag: "UIC-1008", model: "TS 500i Cut-Off Saw", make: "Stihl", modelNumber: "TS 500i", description: "Cut-Off Saw", serial: "ST-61140", cost: "1150", acquired: "2025-02-14", own: "p-warehouse", status: "in_maintenance", cust: null, cur: "p-warehouse", loc: "l-dal", cond: "damaged", warranty: "2027-02-14", dept: false },
    { tag: "UIC-1009", model: "20V Drill/Driver Kit", make: "DeWalt", modelNumber: "20V", description: "Drill/Driver Kit", serial: "DW-90311", cost: "260", acquired: "2025-10-05", own: "p-warehouse", status: "available", cust: null, cur: "p-warehouse", loc: "l-dal", cond: "good", warranty: "2027-10-05", dept: false },
    { tag: "UIC-1010", model: "GLL3-330C Laser Level", make: "Bosch", modelNumber: "GLL3-330C", description: "Laser Level", serial: "BL-22178", cost: "480", acquired: "2025-05-22", own: "p-warehouse", status: "available", cust: null, cur: "p-warehouse", loc: "l-hou", cond: "good", warranty: "2027-05-22", dept: false },
    { tag: "UIC-1011", model: "AWP-30S Personnel Lift", make: "Genie", modelNumber: "AWP-30S", description: "Personnel Lift", serial: "GN-40551", cost: "8900", acquired: "2024-07-08", own: "p-warehouse", status: "available", cust: null, cur: "p-warehouse", loc: "l-hou", cond: "good", warranty: "2026-07-08", dept: false },
    { tag: "UIC-1012", model: "DX 6 Powder Fastener", make: "Hilti", modelNumber: "DX 6", description: "Powder Fastener", serial: "HD-70012", cost: "1350", acquired: "2025-07-19", own: "p-trinity", status: "assigned", cust: "e-dwayne", cur: "p-legacy", loc: "l-gbA", cond: "good", warranty: "2027-07-19", dept: false },
    { tag: "UIC-1013", model: "EK7651H Power Cutter", make: "Makita", modelNumber: "EK7651H", description: "Power Cutter", serial: "MK-31900", cost: "890", acquired: "2024-05-30", own: "p-warehouse", status: "lost", cust: "e-james", cur: "p-uptown", loc: "l-contU", cond: "poor", warranty: "2026-05-30", dept: false },
    { tag: "UIC-1014", model: "GT-1200 Robotic Total Station", make: "Topcon", modelNumber: "GT-1200", description: "Robotic Total Station", serial: "TP-88820", cost: "33000", acquired: "2025-01-30", own: "p-warehouse", status: "reserved", cust: null, cur: "p-gpk", loc: "l-dal", cond: "good", warranty: "2028-01-30", dept: false },
    /* Shop tools: charged to Repair & Maintenance, not to any job, so the
       capital-by-department report has real rows from day one. */
    { tag: "UIC-1015", model: "DX 6 Powder Fastener", make: "Hilti", modelNumber: "DX 6", description: "Powder Fastener", serial: "HD-70104", cost: "1350", acquired: "2025-02-11", own: null, status: "assigned", cust: "e-dave", cur: null, loc: "l-dal", cond: "good", warranty: "2027-02-11", dept: true },
    { tag: "UIC-1016", model: "M18 Impact Kit", make: "Milwaukee", modelNumber: "M18", description: "Impact Kit", serial: "MW-55991", cost: "380", acquired: "2025-08-02", own: null, status: "assigned", cust: "e-dave", cur: null, loc: "l-dal", cond: "good", warranty: "2027-08-02", dept: true },
  ];
  const assetRows = await db
    .insert(asset)
    .values(
      assetSpecs.map((a) => {
        const modelRow = modelRows.find((m) => m.name === a.model)!;
        const catName = modelSpecs.find((m) => m.name === a.model)!.cat;
        return {
          tenantId: tid,
          tag: a.tag,
          modelId: modelRow.id,
          make: a.make,
          modelNumber: a.modelNumber,
          description: a.description,
          categoryName: catName,
          serialNumber: a.serial,
          isSerialized: true,
          quantity: 1,
          acquisitionCost: a.cost,
          acquisitionDate: a.acquired,
          owningProjectId: a.own ? projectByKey[a.own]! : null,
          costTarget: a.dept ? "department" : "project",
          owningDepartmentId: a.dept ? deptRm : null,
          warrantyExpiresOn: a.warranty,
          currentStatus: a.status,
          currentCustodianId: a.cust ? empByKey[a.cust]! : null,
          currentProjectId: a.cur ? projectByKey[a.cur]! : null,
          currentLocationId: locByKey[a.loc]!,
          condition: a.cond,
          createdBy: userByEmail["admin@stinventory.local"]!.id,
        };
      }),
    )
    .returning();
  const assetByTag = Object.fromEntries(assetRows.map((a) => [a.tag, a]));
  console.log(`[seed] ${assetSpecs.length} assets`);

  // ---- Assignments (active custody). Temporary loans carry an expected end date. ----
  const assignSpecs = [
    { tag: "UIC-1001", cust: "e-miguel", proj: "p-legacy", loc: "l-gbA", type: "permanent", start: "2026-01-10", end: null },
    { tag: "UIC-1002", cust: "e-miguel", proj: "p-legacy", loc: "l-gbA", type: "permanent", start: "2026-01-10", end: null },
    { tag: "UIC-1003", cust: "e-dwayne", proj: "p-trinity", loc: "l-truck12", type: "permanent", start: "2026-03-05", end: null },
    { tag: "UIC-1004", cust: "e-sofia", proj: "p-gpk", loc: "l-contH", type: "permanent", start: "2026-02-12", end: null },
    { tag: "UIC-1005", cust: "e-sofia", proj: "p-gpk", loc: "l-contH", type: "temporary", start: "2026-05-15", end: "2026-07-15" },
    { tag: "UIC-1006", cust: "e-james", proj: "p-uptown", loc: "l-contU", type: "permanent", start: "2025-08-10", end: null },
    { tag: "UIC-1007", cust: "e-james", proj: "p-uptown", loc: "l-contU", type: "permanent", start: "2025-09-01", end: null },
    { tag: "UIC-1012", cust: "e-dwayne", proj: "p-legacy", loc: "l-gbA", type: "temporary", start: "2026-06-01", end: "2026-06-25" },
    { tag: "UIC-1015", cust: "e-dave", proj: null, loc: "l-dal", type: "permanent", start: "2026-02-15", end: null },
    { tag: "UIC-1016", cust: "e-dave", proj: null, loc: "l-dal", type: "permanent", start: "2026-08-05", end: null },
  ];
  const adminId = userByEmail["admin@stinventory.local"]!.id;
  await db.insert(assignment).values(
    assignSpecs.map((s) => ({
      tenantId: tid,
      assetId: assetByTag[s.tag]!.id,
      custodianId: empByKey[s.cust]!,
      projectId: s.proj ? projectByKey[s.proj]! : null,
      locationId: locByKey[s.loc]!,
      type: s.type,
      startDate: s.start,
      expectedEndDate: s.end,
      status: "active",
      approvedBy: adminId,
    })),
  );

  // ---- Transaction log (append-only). Mirrors the prototype audit feed + assign events. ----
  const tx = (tag: string, event: string, at: string, note: string, refType?: string, refId?: string) => ({
    tenantId: tid,
    assetId: assetByTag[tag]!.id,
    eventType: event,
    actorId: adminId,
    fromState: null,
    toState: null,
    refType: refType ?? "manual",
    refId: refId ?? null,
    occurredAt: new Date(at),
    note,
  });
  await db.insert(transaction).values([
    tx("UIC-1001", "assign", "2026-01-10 08:12", "Assigned to Miguel Torres — Legacy West", "assignment"),
    tx("UIC-1012", "transfer", "2026-06-01 09:40", "Temp loan Trinity→Legacy, due 2026-06-25", "transfer"),
    tx("UIC-1008", "repair_start", "2026-07-06 10:05", "Cut-off saw damaged blade housing"),
    tx("UIC-1013", "lost", "2026-07-05 16:20", "Not found during Uptown offboarding count"),
    tx("UIC-1014", "reserve", "2026-07-02 11:30", "Reserved for GPK Segment H survey phase"),
    tx("UIC-1009", "return", "2026-06-28 14:15", "Returned to Dallas Yard — Available"),
    tx("UIC-1003", "assign", "2026-03-05 07:30", "Assigned to Dwayne Ellis — Trinity", "assignment"),
    tx("UIC-1004", "assign", "2026-02-12 08:00", "Assigned to Sofia Ramirez — GPK", "assignment"),
    tx("UIC-1005", "assign", "2026-05-15 09:10", "Temp loan to Sofia — GPK, due 2026-07-15", "assignment"),
    tx("UIC-1006", "assign", "2025-08-10 08:00", "Assigned to James Whitaker — Uptown", "assignment"),
    tx("UIC-1007", "assign", "2025-09-01 08:00", "Assigned to James Whitaker — Uptown", "assignment"),
    tx("UIC-1002", "assign", "2026-01-10 08:30", "Assigned to Miguel Torres — Legacy West", "assignment"),
    tx("UIC-1015", "assign", "2026-02-15 07:45", "Assigned to Dave Kowalski — shop", "assignment"),
    tx("UIC-1016", "assign", "2026-08-05 08:20", "Assigned to Dave Kowalski — shop", "assignment"),
  ]);
  console.log(`[seed] 14 transactions`);

  // ---- Notifications ----
  await db.insert(notification).values([
    { tenantId: tid, recipientEmployeeId: empByKey["e-dwayne"]!, type: "overdue", refType: "assignment", title: "Overdue temporary loan: UIC-1012", body: "DX 6 Powder Fastener loaned 2026-06-01, due 2026-06-25 — 14 days overdue.", channel: "in_app" },
    { tenantId: tid, recipientEmployeeId: empByKey["e-karen"]!, type: "clearance_required", refType: "employee", refId: empByKey["e-james"]!, title: "HR clearance: James Whitaker", body: "Terminated foreman still holds 3 assets (1 marked Lost). Review before offboarding sign-off.", channel: "in_app" },
    { tenantId: tid, recipientEmployeeId: empByKey["e-karen"]!, type: "missing", refType: "asset", refId: assetByTag["UIC-1013"]!.id, title: "Missing tool: UIC-1013", body: "EK7651H Power Cutter not found during Uptown count.", channel: "in_app" },
  ]);
  console.log(`[seed] 3 notifications`);

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

Login (password: stinventory-demo):
  owner@stinventory.local           Owner — full access
  admin@stinventory.local            Karen Osei — Equipment Admin
  warehouse@stinventory.local        Yard Desk — Warehouse
  foreman.miguel@stinventory.local   Miguel Torres — Foreman
  super.carlos@stinventory.local     Carlos Mendez — Superintendent
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
