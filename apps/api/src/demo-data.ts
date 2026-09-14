/*
  `make demo` — load the local-only dummy dataset from `docs/import/*.csv`.

  NOT a seed, and NOT part of `provision`. It reads the spreadsheets that are
  already in the repository, pushes them through the REAL importers, builds the
  roster through `projectTeam.assign` and hands a few tools out through the
  custody writer. Nothing here writes a row by hand that an importer or a router
  could write correctly — that is what keeps the demo's data obeying the same
  invariants as real data, and therefore worth looking at.

  Local only, twice over: it refuses to run with `NODE_ENV=production` unless
  `DEMO_ALLOWED=1` says somebody really meant it, and the tenant it targets is
  the local one (`DEMO_TENANT_SLUG`, default `urban`).

  Idempotent. Every step either asks the importer whether the row already exists
  or checks first: projects/employees/vehicles by their unique keys, tools by a
  content fingerprint (the untagged ones have no unique key at all), the roster
  by the active-row check inside `projectTeam.assign`, accounts by email, and
  assignments by the tool already having a custodian. Re-running loads nothing
  twice.

  Run:
    make demo
    DEMO_TENANT_SLUG=urban make demo
*/
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  appRouter,
  buildRoster,
  dedupeTruckForemen,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  employeeImportRows,
  mergeProjectCsvs,
  projectImportRows,
  toolImportRows,
  vehicleImportRows,
  type Context,
} from "@optix/api-contracts";
import { createDb, schema } from "@optix/db";
import { PERMISSIONS, type Permission } from "@optix/types";
import { hashPassword } from "@optix/auth";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[demo] DATABASE_URL is not set.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && process.env.DEMO_ALLOWED !== "1") {
  console.error("[demo] refusing to run against production. Set DEMO_ALLOWED=1 to override.");
  process.exit(1);
}

const db = createDb(url);
const tenantSlug = (
  process.env.DEMO_TENANT_SLUG?.trim() ||
  process.env.TENANT_SLUG?.trim() ||
  "urban"
).toLowerCase();

const keyName = (s: string) => s.trim().toLowerCase();
const folder = fileURLToPath(new URL("../../../", import.meta.url));
const importDir = process.env.DEMO_IMPORT_DIR?.trim() || path.join(folder, "docs", "import");
const read = (rel: string) => readFileSync(path.join(importDir, rel), "utf8");

async function main() {
  console.log(`[demo] tenant ${tenantSlug}`);
  console.log(`[demo] source ${importDir}\n`);

  const [tenant] = await db
    .select({ id: schema.tenant.id, name: schema.tenant.name })
    .from(schema.tenant)
    .where(eq(schema.tenant.slug, tenantSlug));
  if (!tenant) {
    console.error(`[demo] no tenant "${tenantSlug}". Run 'make provision' first.\n`);
    process.exit(1);
  }
  const tid = tenant.id;

  /* The owner is the actor so every import and roster write carries the same
     authority an administrator would exercise by hand. Falls back to any user
     in the tenant, because a lone admin is still enough. */
  const owner = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .innerJoin(schema.userRole, eq(schema.userRole.userId, schema.user.id))
    .innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
    .where(and(eq(schema.user.tenantId, tid), eq(schema.role.name, "owner")))
    .limit(1);
  const fallback = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.tenantId, tid))
    .limit(1);
  const actorUserId = owner[0]?.id ?? fallback[0]?.id;
  if (!actorUserId) {
    console.error("[demo] this tenant has no users to act as. Run 'make provision' first.\n");
    process.exit(1);
  }

  const ctx: Context = {
    db,
    session: {
      userId: actorUserId,
      tenantId: tid,
      employeeId: null,
      permissions: new Set<Permission>(PERMISSIONS),
      roleName: "owner",
      actorLabel: "demo loader",
    },
    sessionSecret: "demo-loader",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  };
  const caller = appRouter.createCaller(ctx);

  /* ---- 1. read + merge the two project files ---------------------------- */
  const merge = mergeProjectCsvs(read("01-projects.csv"), read("project-extraction/projects.csv"));
  console.log(`  projects              ${merge.projects.length} merged`);

  /* ---- 2. imports: projects, then what references them ------------------ */

  const existingProjectCodes = new Set(
    (await db.select({ code: schema.project.code }).from(schema.project).where(eq(schema.project.tenantId, tid)))
      .map((r) => r.code?.toLowerCase())
      .filter((c): c is string => !!c),
  );
  const newProjects = projectImportRows(merge).filter(
    (r) => !existingProjectCodes.has(String(r.project_code).toLowerCase()),
  );
  if (newProjects.length) await caller.import.commit({ entity: "project", rows: newProjects });
  console.log(`  projects imported     ${newProjects.length}`);

  /* Reload so names resolve to ids for everything imported afterwards. */
  const projectRows = await db
    .select({ id: schema.project.id, code: schema.project.code, name: schema.project.name })
    .from(schema.project)
    .where(eq(schema.project.tenantId, tid));
  const projectIdByName = new Map(projectRows.map((p) => [keyName(p.name), p.id]));

  /* The merge renamed a base file's placeholder ("Job 24002") to the real name
     ("Frisco Dallas Pkwy - Punchout"); other spreadsheets still say the old
     one, so it is resolved through the alias rather than blanked. */
  const resolveProjectName = (raw: string): string | null => {
    if (!raw) return null;
    const candidate = merge.aliases.get(keyName(raw)) ?? raw;
    return projectIdByName.has(keyName(candidate)) ? candidate : null;
  };

  /* ---- 3. locations, before anything references them ------------------- */
  const yardProjectId = projectRows.find((p) => p.code === "10001")?.id ?? null;
  let [yard] = await db
    .select({ id: schema.warehouse.id })
    .from(schema.warehouse)
    .where(and(eq(schema.warehouse.tenantId, tid), eq(schema.warehouse.name, "Equipment Yard")));
  if (!yard) {
    [yard] = await db
      .insert(schema.warehouse)
      .values({ tenantId: tid, name: "Equipment Yard", address: "Equipment Yard" })
      .returning({ id: schema.warehouse.id });
    console.log("  warehouse             created");
  }
  const yardName = "Equipment Yard";
  const [yardLocation] = await db
    .select({ id: schema.location.id })
    .from(schema.location)
    .where(and(eq(schema.location.tenantId, tid), eq(schema.location.name, yardName)));
  if (!yardLocation) {
    await db.insert(schema.location).values({
      tenantId: tid,
      type: "warehouse",
      name: yardName,
      warehouseId: yard!.id,
      projectId: yardProjectId,
    });
  }
  const siteName = "Lone Star I-35 East Phase 2";
  const [siteLocation] = await db
    .select({ id: schema.location.id })
    .from(schema.location)
    .where(and(eq(schema.location.tenantId, tid), eq(schema.location.name, siteName)));
  if (!siteLocation) {
    await db.insert(schema.location).values({
      tenantId: tid,
      type: "project_site",
      name: siteName,
      projectId: projectIdByName.get(keyName(siteName)) ?? null,
    });
  }
  console.log("  locations             Equipment Yard, one project site");

  /* ---- 4a. people ------------------------------------------------------- */
  const existingEmployeeCodes = new Set(
    (await db.select({ code: schema.employee.code }).from(schema.employee).where(eq(schema.employee.tenantId, tid)))
      .map((r) => r.code?.toLowerCase())
      .filter((c): c is string => !!c),
  );
  const newEmployees = employeeImportRows(read("03-employees-FALLBACK.csv"), resolveProjectName).filter(
    (r) => !existingEmployeeCodes.has(String(r.employee_id).toLowerCase()),
  );
  if (newEmployees.length) await caller.import.commit({ entity: "employee", rows: newEmployees });
  console.log(`  people imported       ${newEmployees.length}`);

  /* ---- 4b. vehicles ----------------------------------------------------- */
  const employeeRows = await db
    .select({ id: schema.employee.id, name: schema.employee.name })
    .from(schema.employee)
    .where(eq(schema.employee.tenantId, tid));
  const employeeIdByName = new Map(employeeRows.map((e) => [keyName(e.name), e.id]));
  const resolveEmployeeName = (raw: string): string | null =>
    raw && employeeIdByName.has(keyName(raw)) ? raw : null;

  const heldTruckForemanRows = await db
    .select({ name: schema.employee.name })
    .from(schema.equipment)
    .innerJoin(schema.employee, eq(schema.employee.id, schema.equipment.foremanEmployeeId))
    .where(and(eq(schema.equipment.tenantId, tid), eq(schema.equipment.vehicleType, "truck")));
  const heldTruckForemen = new Set(heldTruckForemanRows.map((r) => keyName(r.name)));

  const existingUnits = new Set(
    (await db.select({ unit: schema.equipment.code }).from(schema.equipment).where(eq(schema.equipment.tenantId, tid))).map(
      (r) => r.unit.toLowerCase(),
    ),
  );
  const newVehicles = dedupeTruckForemen(
    vehicleImportRows(read("02-vehicles.csv"), resolveProjectName, resolveEmployeeName),
    heldTruckForemen,
  ).filter((r) => !existingUnits.has(String(r.unit).toLowerCase()));
  if (newVehicles.length) await caller.import.commit({ entity: "vehicle", rows: newVehicles });
  console.log(`  vehicles imported     ${newVehicles.length}`);

  /* ---- 4c. tools -------------------------------------------------------- */
  /*
     Deduped by a content fingerprint, not by `serial`: 407 of the 753 tools
     have no serial at all (Urban's sheets do not label them), and the import
     spec only enforces uniqueness on values that are present — so a re-run
     would duplicate every untagged tool. The fingerprint is counted, not set,
     because two identical "14" QUIKIE SAW" rows are two real tools.
  */
  const fingerprint = (parts: (string | null | undefined)[]) =>
    parts.map((p) => (p ?? "").trim().toLowerCase()).join("\u0000");
  const existingAssetCounts = new Map<string, number>();
  for (const a of await db
    .select({
      description: schema.smallTool.description,
      make: schema.smallTool.make,
      modelNumber: schema.smallTool.modelNumber,
      serialNumber: schema.smallTool.serialNumber,
    })
    .from(schema.smallTool)
    .where(eq(schema.smallTool.tenantId, tid))) {
    const fp = fingerprint([a.description, a.make, a.modelNumber, a.serialNumber]);
    existingAssetCounts.set(fp, (existingAssetCounts.get(fp) ?? 0) + 1);
  }
  const newTools = toolImportRows(read("04-tools.csv")).filter((r) => {
    const fp = fingerprint([r.description, r.make, r.model, r.serial]);
    const left = existingAssetCounts.get(fp) ?? 0;
    if (left > 0) {
      existingAssetCounts.set(fp, left - 1);
      return false;
    }
    return true;
  });
  if (newTools.length) await caller.import.commit({ entity: "asset", rows: newTools });
  console.log(`  tools imported        ${newTools.length}`);

  /* ---- 5. the roster, through the real assignment writer ---------------- */
  /*
     No importer exists for the roster, and it must not be raw-inserted:
     `projectTeam.assign` is what opens the posting, moves the person's tools
     and keeps `reportsTo` coherent. Built top-down so a manager exists before
     the people who report to them are placed.
  */
  const roleFor = (kind: "director" | "pm" | "foreman") => (kind === "foreman" ? "foreman" : "pm");

  const ensureEmployee = async (name: string, kind: "director" | "pm" | "foreman"): Promise<string> => {
    const existing = employeeIdByName.get(keyName(name));
    if (existing) return existing;
    const [row] = await db
      .insert(schema.employee)
      .values({ tenantId: tid, name, role: roleFor(kind), employmentStatus: "active" })
      .returning({ id: schema.employee.id });
    employeeIdByName.set(keyName(name), row!.id);
    return row!.id;
  };

  const roster = buildRoster(read("project-extraction/projects.csv"), new Map(merge.projects.map((p) => [p.code, p.name])));

  /*
    Collect the FINAL placement for each person before writing any of it.

    A foreman works one job at a time, so `assign` closes their row on the old
    job when they move. Walking the file and assigning as it goes therefore
    reopens and re-closes the same foreman a dozen times a run — harmless on the
    first load, but churn on every re-run. Reducing to one placement per person
    first (last mention wins) is what makes a re-run genuinely change nothing.
  */
  type Placement = { projectId: string; employeeId: string; role: string; reportsToEmployeeId?: string | null };
  const orgPlacements: Placement[] = [];
  const foremanPlacement = new Map<string, Placement>();

  for (const entry of roster) {
    const projectId = projectIdByName.get(keyName(entry.projectName));
    if (!projectId) continue;

    let directorId: string | null = null;
    for (const name of entry.directors) {
      const id = await ensureEmployee(name, "director");
      orgPlacements.push({ projectId, employeeId: id, role: "director" });
      directorId ??= id;
    }
    let pmId: string | null = null;
    if (entry.pm) {
      pmId = await ensureEmployee(entry.pm, "pm");
      orgPlacements.push({ projectId, employeeId: pmId, role: "pm", reportsToEmployeeId: directorId });
    }
    for (const name of entry.foremen) {
      const id = await ensureEmployee(name, "foreman");
      foremanPlacement.set(id, { projectId, employeeId: id, role: "foreman", reportsToEmployeeId: pmId ?? directorId });
    }
  }

  let placements = 0;
  let opened = 0;
  /* Directors and PMs first — the tiers foremen report to — then the foremen. */
  for (const p of [...orgPlacements, ...foremanPlacement.values()]) {
    const res = await caller.projectTeam.assign({ ...p, source: "manual_entry" });
    placements++;
    /* `assign` answers `alreadyAssigned` when an active row for this
       (job, person, tier) is already there. Counting only the other ones is
       what makes "re-running changes nothing" a number rather than a promise. */
    if (!("alreadyAssigned" in res)) opened++;
  }
  console.log(`  roster                ${opened} rows opened, ${placements - opened} already there`);

  /* ---- 6. the five demo accounts ---------------------------------------- */
  /*
     Inserted directly, exactly as `provision.ts` does — never through
     `user.invite`, which would send mail. One shared password, no forced
     change, so the demo is a sign-in rather than a setup exercise.
  */
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  let accountsCreated = 0;
  for (const account of DEMO_ACCOUNTS) {
    const [role] = await db
      .select({ id: schema.role.id })
      .from(schema.role)
      .where(and(eq(schema.role.tenantId, tid), eq(schema.role.name, account.role)));
    if (!role) {
      console.warn(`  !! no "${account.role}" role — skipping ${account.email}`);
      continue;
    }
    const [existing] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(and(eq(schema.user.tenantId, tid), eq(schema.user.email, account.email)));
    if (existing) continue;

    let employeeId = employeeIdByName.get(keyName(account.employeeName));
    if (!employeeId) {
      const [row] = await db
        .insert(schema.employee)
        .values({ tenantId: tid, name: account.employeeName, role: "foreman", employmentStatus: "active" })
        .returning({ id: schema.employee.id });
      employeeId = row!.id;
      employeeIdByName.set(keyName(account.employeeName), employeeId);
    }
    const [user] = await db
      .insert(schema.user)
      .values({
        tenantId: tid,
        employeeId,
        email: account.email,
        passwordHash,
        firstName: account.firstName,
        lastName: account.lastName,
        isActive: true,
        mustChangePassword: false,
      })
      .returning({ id: schema.user.id });
    await db.insert(schema.userRole).values({ userId: user!.id, roleId: role.id });
    accountsCreated++;
  }
  console.log(`  demo accounts         ${accountsCreated} created`);

  /* ---- 7. a few tools in a few hands ------------------------------------ */
  /*
     Through `assignment.create` — the custody writer — so the ledger gets its
     genesis `assign` event, the projection is applied and the active-link
     invariant holds. Tools already held are skipped, which is what makes a
     re-run a no-op.
  */
  /*
     Guarded on "has this tenant ever handed a tool out", not on "is this tool
     free". Picking the next free tools makes every run hand out twelve MORE —
     skip, not top-up, which is what makes a re-run a no-op.
  */
  const [assignmentCount] = await db
    .select({ handedOut: sql<number>`count(*)::int` })
    .from(schema.assignment)
    .where(eq(schema.assignment.tenantId, tid));
  const handedOut = assignmentCount?.handedOut ?? 0;
  const custodianIds = ["Frank Foreman", "Gina Foreman", "Cody Crew"]
    .map((n) => employeeIdByName.get(keyName(n)))
    .filter((id): id is string => !!id);
  const availableAssets = !handedOut && custodianIds.length
    ? await db
        .select({ id: schema.smallTool.id })
        .from(schema.smallTool)
        .where(and(eq(schema.smallTool.tenantId, tid), isNull(schema.smallTool.currentCustodianId)))
        .orderBy(schema.smallTool.assetNumber)
        .limit(12)
    : [];
  let assigned = 0;
  for (const [i, asset] of availableAssets.entries()) {
    await caller.assignment.create({ assetId: asset.id, custodianId: custodianIds[i % custodianIds.length]! });
    assigned++;
  }
  console.log(`  tools assigned        ${assigned}`);

  /* ---- report the names nobody could supply ----------------------------- */
  console.log("\n[demo] done.");
  if (merge.needsRealName.length) {
    console.log(`\n  ${merge.needsRealName.length} project(s) still carry a placeholder name and need a real one:`);
    console.log(`    ${merge.needsRealName.join(", ")}`);
  }
  console.log("\n  Sign in as any demo account — password: " + DEMO_PASSWORD);
  for (const a of DEMO_ACCOUNTS) console.log(`    ${a.email.padEnd(40)} ${a.role}`);
  console.log("");
}

await main();
process.exit(0);
