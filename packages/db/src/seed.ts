import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { PERMISSIONS, ROLES } from "@stinventory/types";
import * as schema from "./schema/index.js";
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
    "project.manage",
    "employee.read",
    "assignment.read",
    "assignment.create",
    "rental.read",
    "transfer.read",
    "transfer.create",
    "report.read",
    "notification.read",
    "notification.manage",
    /* The equipment department sits at the same tier as admins for who gets
       put on a project (docs: project.team.assign hierarchy) — and it keeps
       project.manage so the yard desk sees every job, the way admins do. */
    "project.team.read",
    "project.assign.pm",
    "project.assign.superintendent",
    "project.assign.foreman",
  ],
  superintendent: [
    "asset.read", "location.read", "vehicle.read", "project.read", "employee.read",
    "assignment.read", "assignment.create", "assignment.approve",
    "transfer.read", "transfer.create", "transfer.approve",
    "report.read", "notification.read",
    /* Superintendents put foremen on their projects. */
    "project.team.read",
    "project.assign.foreman",
  ],
  procurement: ["asset.read", "project.read", "employee.read", "report.read"],
  project_manager: [
    "asset.read", "project.read", "project.manage", "employee.read", "report.read",
    /* PMs assign superintendents and foremen to their projects. */
    "project.team.read",
    "project.assign.superintendent",
    "project.assign.foreman",
  ],
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
    /* A foreman can see who else is on the project they work. */
    "project.team.read",
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
    await db.delete(vehicle);
    await db.delete(location);
    await db.delete(employeeProjectAssignment); // before employees — it points at them
    await db.delete(projectTeamMember); // before employees and projects — it points at both
    await db.delete(employee);
    await db.delete(project);
    await db.delete(warehouse);
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
      projectId: v.proj ? projectByKey[v.proj]! : null,
      foremanEmployeeId: v.foreman ? empByKey[v.foreman]! : null,
    })),
  );
  console.log(`[seed] ${vehSpecs.length} trailers (no trucks in source)`);

  // ---- Assets (the register). current_* projection set at seed time; matching
  // transactions are appended below so the rebuild guarantee holds.
  // `make`/`modelNumber`/`description` are the flat columns Urban's sheets use.
  // No model catalog: the tools-list source carries its own make/model strings.
  // Cost target: serialized tools -> Equipment Department, the rest -> the
  // Purchased project they ride with.
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
        acquisitionCost: a.cost,
        acquisitionDate: null,
        owningProjectId: a.own ? projectByKey[a.own]! : null,
        costTarget: a.dept ? "department" : "project",
        owningDepartmentId: a.dept ? deptByCode["EQ"]! : null,
        warrantyExpiresOn: null,
        currentStatus: a.status,
        currentCustodianId: a.cust ? empByKey[a.cust]! : null,
        currentProjectId: a.cur ? projectByKey[a.cur]! : null,
        currentLocationId: locByKey[a.loc]!,
        condition: "good",
        createdBy: userByEmail["admin@stinventory.local"]!.id,
      })),
    )
    .returning();
  const assetByTag = Object.fromEntries(assetRows.map((a) => [a.tag, a]));
  console.log(`[seed] ${assetSpecs.length} assets`);

  // ---- Assignments (active custody). One per tool with a foreman. ----
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
  console.log(`[seed] ${assignSpecs.length} assignments`);

  // ---- Transaction log (append-only). One assign event per tool so the
  // activity feed has the tools-list history and the rebuild guarantee holds. ----
  await db.insert(transaction).values(
    txSpecs.map((t) => ({
      tenantId: tid,
      assetId: assetByTag[t.tag]!.id,
      eventType: t.event,
      actorId: adminId,
      fromState: null,
      toState: null,
      refType: t.ref,
      refId: null,
      occurredAt: new Date(t.at),
      note: t.note,
    })),
  );
  console.log(`[seed] ${txSpecs.length} transactions`);

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
  owner@stinventory.local      Owner — full access
  admin@stinventory.local       Karen Osei — Equipment Admin
  warehouse@stinventory.local   Yard Desk — Warehouse

Data (from TOOL LIST BY NAME.xlsx):
  ${employeeRows.length - 2} foremen, ${projectRows.length} projects,
  ${vehSpecs.length} trailers, ${assetRows.length} tools
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
