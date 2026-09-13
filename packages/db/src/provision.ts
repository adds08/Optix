/*
  Provision a tenant: the authority model, and the two accounts that can sign in.

  This is what `make provision` runs, and it is NOT a seed. It writes no
  business data — no employees, no jobs, no tools, no vehicles, no custody.
  Those come from the importers and the BambooHR sync, from Urban's own
  sources. The seed that used to invent them was deleted on 2026-09-13 for
  exactly that reason.

  What it does write is the part a database cannot be used without:

    permissions   the 35 verbs the code checks BY NAME. Not configuration —
                  `requirePermission("asset.manage")` fails closed if the row
                  is absent, so every one has to exist.
    roles         named bundles of those verbs, from `roleSpecs`.
    tiers         the job ladder and its "Set by" edges, from `teamRoleSpecs`.
    vocabularies  categories, units of measure, departments.
    two accounts  the Optix technical administrator, and the customer's own.

  IDEMPOTENT. Every insert is `onConflictDoNothing` or an explicit existence
  check, so running it twice changes nothing and running it against a tenant
  that already exists is safe. It never deletes.

  Run:
    make provision                       # Urban, generated password
    make provision TENANT="Acme" SLUG=acme
    ADMIN_PASSWORD=... make provision    # pick the password yourself
*/
import "dotenv/config";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "./index";
import * as schema from "./schema/index";
import { ROLES, PERMISSIONS, type Permission } from "@optix/types";
import { ROLE_PERMS } from "./role-perms";
import {
  roleSpecs,
  teamRoleSpecs,
  categorySpecs,
  departmentSpecs,
  uomCategorySpecs,
  uomSpecs,
} from "./tenant-config";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const tenantName = process.env.TENANT_NAME?.trim() || "Urban Infraconstruction LLC";
const tenantSlug = (process.env.TENANT_SLUG?.trim() || "urban").toLowerCase();
/* Optix's own operator, and the customer's administrator. Overridable so a
   second tenant does not have to borrow Urban's addresses. */
const techEmail = process.env.TECH_ADMIN_EMAIL?.trim() || "tech@optixtec.com";
const ownerEmail = process.env.OWNER_EMAIL?.trim() || "optix_it@optixtec.com";

const db = createDb(url);

/* bcrypt lives in @optix/auth, which depends on this package — importing
   it here would close a cycle. The cost factor is the one `hashPassword` uses. */
const bcrypt = (await import("bcryptjs")).default;

async function main() {
  console.log(`[provision] ${tenantName} (${tenantSlug})`);
  console.log(`[provision] ${url!.replace(/:[^:@]*@/, ":***@")}\n`);

  /* ---- tenant ---------------------------------------------------------- */
  let [tenant] = await db
    .select({ id: schema.tenant.id })
    .from(schema.tenant)
    .where(eq(schema.tenant.slug, tenantSlug));
  if (!tenant) {
    [tenant] = await db
      .insert(schema.tenant)
      .values({ name: tenantName, slug: tenantSlug })
      .returning({ id: schema.tenant.id });
    console.log("  tenant                created");
  } else {
    console.log("  tenant                exists");
  }
  const tid = tenant!.id;

  /* ---- permissions ------------------------------------------------------
     Global, not per-tenant: the name IS the identity, and the code checks it
     by string. A missing row means the procedure guarding it can never pass. */
  await db
    .insert(schema.permission)
    .values(PERMISSIONS.map((name) => ({ name })))
    .onConflictDoNothing();
  /* Counted from the table, not from the constant: migrations insert some of
     these too, so the constant's length is not the number of rows present. */
  const permRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.permission);
  console.log(`  permissions           ${permRows[0]?.n ?? 0}`);

  /* ---- roles + their grants -------------------------------------------- */
  for (const spec of roleSpecs) {
    const [existing] = await db
      .select({ id: schema.role.id })
      .from(schema.role)
      .where(and(eq(schema.role.tenantId, tid), eq(schema.role.name, spec.name)));
    let roleId = existing?.id;
    if (!roleId) {
      const [row] = await db
        .insert(schema.role)
        .values({
          tenantId: tid,
          name: spec.name,
          description: spec.description,
          canHoldCustody: spec.canHoldCustody,
          usesFieldLayout: spec.usesFieldLayout,
          isCrossTenant: spec.isCrossTenant ?? false,
        })
        .returning({ id: schema.role.id });
      roleId = row!.id;
    }
    const perms = ROLE_PERMS[spec.name as (typeof ROLES)[number]] ?? [];
    if (perms.length) {
      await db
        .insert(schema.rolePermission)
        .values(perms.map((p) => ({ roleId: roleId!, permissionName: p as Permission })))
        .onConflictDoNothing();
    }
  }
  console.log(`  roles                 ${roleSpecs.length}`);

  /* ---- job tiers --------------------------------------------------------
     Two passes: the ladder and the "Set by" edges both point at tiers, so
     every row has to exist before any edge can be written. */
  const tierId = new Map<string, string>();
  for (const spec of teamRoleSpecs) {
    const [existing] = await db
      .select({ id: schema.teamRole.id })
      .from(schema.teamRole)
      .where(and(eq(schema.teamRole.tenantId, tid), eq(schema.teamRole.name, spec.name)));
    if (existing) {
      tierId.set(spec.name, existing.id);
      continue;
    }
    const [row] = await db
      .insert(schema.teamRole)
      .values({
        tenantId: tid,
        name: spec.name,
        label: spec.label,
        canHoldCustody: spec.canHoldCustody,
      })
      .returning({ id: schema.teamRole.id });
    tierId.set(spec.name, row!.id);
  }
  for (const spec of teamRoleSpecs) {
    const self = tierId.get(spec.name)!;
    if (spec.reportsTo) {
      await db
        .update(schema.teamRole)
        .set({ reportsToTeamRoleId: tierId.get(spec.reportsTo) ?? null })
        .where(eq(schema.teamRole.id, self));
    }
    for (const by of spec.setBy) {
      const assigner = tierId.get(by);
      if (!assigner) continue;
      await db
        .insert(schema.teamRoleAssigner)
        .values({ teamRoleId: self, assignerTeamRoleId: assigner })
        .onConflictDoNothing();
    }
  }
  console.log(`  job tiers             ${teamRoleSpecs.length}`);

  /* ---- vocabularies ----------------------------------------------------- */
  if (categorySpecs.length) {
    await db
      .insert(schema.category)
      .values(categorySpecs.map((name) => ({ tenantId: tid, name })))
      .onConflictDoNothing();
  }
  if (departmentSpecs.length) {
    await db
      .insert(schema.department)
      .values(departmentSpecs.map((d) => ({ tenantId: tid, name: d.name, code: d.code })))
      .onConflictDoNothing();
  }
  if (uomCategorySpecs.length) {
    await db
      .insert(schema.uomCategory)
      .values(uomCategorySpecs.map((c) => ({ tenantId: tid, code: c.code, name: c.name })))
      .onConflictDoNothing();
  }
  console.log(`  categories            ${categorySpecs.length}`);
  console.log(`  departments           ${departmentSpecs.length}`);

  /* ---- the two accounts --------------------------------------------------
     Everybody else joins by invitation. `mustChangePassword` is set on both:
     a provisioned password has been through a terminal and a shell history,
     so it is a delivery mechanism, not a credential. */
  const password = process.env.ADMIN_PASSWORD?.trim() || crypto.randomBytes(12).toString("base64url");
  const hash = await bcrypt.hash(password, 12);
  const accounts = [
    { email: techEmail, role: "tech_admin", first: "Optix", last: "Tech Admin" },
    { email: ownerEmail, role: "owner", first: "Tenant", last: "Administrator" },
  ];

  let created = 0;
  for (const a of accounts) {
    const [role] = await db
      .select({ id: schema.role.id })
      .from(schema.role)
      .where(and(eq(schema.role.tenantId, tid), eq(schema.role.name, a.role)));
    if (!role) {
      console.error(`  !! role ${a.role} missing — cannot create ${a.email}`);
      continue;
    }
    const [existing] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(and(eq(schema.user.tenantId, tid), eq(schema.user.email, a.email)));
    if (existing) {
      console.log(`  ${a.email.padEnd(24)} exists (password unchanged)`);
      continue;
    }
    const [user] = await db
      .insert(schema.user)
      .values({
        tenantId: tid,
        email: a.email,
        firstName: a.first,
        lastName: a.last,
        passwordHash: hash,
        isActive: true,
        mustChangePassword: true,
      })
      .returning({ id: schema.user.id });
    await db.insert(schema.userRole).values({ userId: user!.id, roleId: role.id });
    console.log(`  ${a.email.padEnd(24)} created (${a.role})`);
    created++;
  }

  console.log("\n[provision] done. The register is EMPTY — no people, jobs, tools or vehicles.");
  if (created) {
    console.log(`\n  password for the new account(s): ${password}`);
    console.log("  Both must change it on first sign-in.\n");
  }
  console.log("  Import real data — see docs/import/README.md\n");
}

await main();
process.exit(0);
