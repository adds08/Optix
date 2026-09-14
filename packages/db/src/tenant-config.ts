/*
  TENANT CONFIGURATION — the vocabularies and the authority model.

  This is what a tenant IS before anybody imports a single row: its login roles
  and what each may do, its job tiers and who may assign whom, the shelves tools
  are filed on, the units they are measured in, and the departments that own
  them.

  It is deliberately NOT data. There are no people here, no jobs, no tools, no
  vehicles and no custody — those come from Urban's own sources through the
  importers and the BambooHR sync.

  The seed that used to invent them was deleted on 2026-09-13. It had shipped
  tool codes Urban never had (`TOOL-0001`; `schema/asset.ts` records that their
  sheets carry no tool-ID column at all), loaded 31 of 88 vehicles while
  silently dropping the rest, and produced a project list with eight jobs named
  `Job 24002`. Data that is approximately right is worse than no data, because
  nothing on screen says which rows to trust.

  Read by `packages/db/src/index.ts`, by `rbac-matrix.test.ts`,
  `team-role-baseline.test.ts` and `account-lifecycle.test.ts`, and by whatever
  provisions a new tenant.
*/

export type DeptSeed = { name: string; code: string };

/*
  STI-104: the register's categories.

  The tools list carries no category column, so every imported asset has
  `category_name` NULL and `category` was seeded EMPTY. That made the whole
  category surface dead from a clean database — `category.list` returned
  nothing, so the bulk re-file picker and the register's category filter both
  offered zero options and could not be exercised without hand-inserting rows
  in psql. CLAUDE.md rule 8: data the seed cannot produce is behaviour nobody
  tests.

  These are the shelves Urban's list actually falls into, read off the tool
  descriptions (drills, grinders, quikie saws, compactors, generators,
  blowers, survey kit). Deliberately a short flat list, not a taxonomy: a
  category is a shelf label, and a hierarchy nobody asked for is a migration
  waiting to happen.
*/
export const categorySpecs: string[] = [
  "Drills & Drivers",
  "Grinders",
  "Saws",
  "Compaction",
  "Generators & Power",
  "Blowers & Yard",
  "Survey & Layout",
  "Hand Tools",
];

export const departmentSpecs: DeptSeed[] = [
  { name: "Repair & Maintenance", code: "RM" },
  { name: "Equipment Department", code: "EQ" },
  { name: "Purchased Department", code: "PUR" },
];

/*
  Units of measure, and the categories they sort into (2026-08-27).

  Seeded rather than left to an administrator because a table nobody has put a
  row in is indistinguishable from a table nobody needs — which is the argument
  that eventually deleted `project_phase`. These are the units a Texas civil
  contractor's takeoff actually uses.

  `lump-sum` is a category of its own on purpose. LS measures nothing, and
  filing it under "count" would make it look convertible to EA, which it is not.
*/
/*
  The role register (2026-08-28), replacing three overlapping ideas.

  `needsLogin` false is the case the whole flag exists for: most of a yard holds
  tools and never signs in. Without it the people register cannot tell "not
  invited yet" from "will never have an account", and every labourer reads as an
  outstanding task forever.

  `crew` is seeded specifically so that state is reachable from a clean database.
  It is the only role with `needsLogin: false` and it carries NO permissions —
  CLAUDE.md rule 9: a flag nothing seeds is behaviour nobody tests, and the edge
  that trips the rule is the one worth having.

  The booleans started as a move rather than a redesign: `canHoldCustody` was
  the old `CUSTODIAN_ROLES` and `usesFieldLayout` the old `FIELD_ROLES`. They
  are no longer frozen — `superintendent` gained `canHoldCustody` on
  2026-09-01, because a job is routinely rigged before its foreman is hired and
  the superintendent is who actually holds the tools until then.
  `canHoldCustody` and `CUSTODIAN_ROLES` must still agree in both directions,
  which `rbac-matrix.test.ts` asserts for a freshly seeded tenant — and a live
  database needs a migration to follow, since the seed never runs there. Verify
  against `packages/types/src/enums.ts` and `nav-config.ts` before changing
  either.
*/
export type RoleSeed = {
  name: string;
  description: string;
  /* What `employee.role` answers, moved onto this register — see the column
     comment on `role.category` in identity.ts. Null for a role the old
     nine-value enum had no name for. (`employee.role` itself is still present
     and still read; this is the column its readers migrate to.) */
  category?: string;
  needsLogin: boolean;
  canHoldCustody: boolean;
  usesFieldLayout: boolean;
  /* equipment | people | none — which wizard first login runs. See the column
     comment on `role.onboardingKind`. */
  onboardingKind: string;
  /* Reaches every tenant. Only `tech_admin`. Nothing reads it yet — see the
     column comment. */
  isCrossTenant?: boolean;
  /*
    JOB TIERS this role may put ITSELF into, on a project of its own choosing.
    Empty (the default) means no self-claiming — see `role.claimTierNames`.

    Only the two leadership roles carry one, and that is the bootstrap: an
    empty tenant has nobody on any job, so no tier-on-a-project exists for
    `assertCanAssign` to read, so nobody can be placed by anybody. One role
    able to place ITSELF is what breaks the circle; everyone below is then
    placed through the ordinary "Set by" chain.
  */
  claimTierNames?: string[];
  isSystem: boolean;
};

export const roleSpecs: RoleSeed[] = [
  { name: "owner", description: "Full authority over the organisation, its configuration and its people.", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "none", isSystem: true },
  /* Optix's own operator. Same grants as `owner` inside a tenant; what differs
     is `isCrossTenant`. No wizard — a technical administrator is not describing
     their own crew. */
  { name: "tech_admin", description: "Optix technical administrator. Supports every tenant; not the customer's own administrator.", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "none", isCrossTenant: true, isSystem: true },
  { name: "equipment_admin", description: "Runs the equipment department: the register, custody, and who holds what.", category: "equipment_admin", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "equipment", isSystem: true },
  { name: "office_admin", description: "Business records and accounts. Not custody, and not platform configuration.", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "none", isSystem: true },
  { name: "warehouse", description: "The yard desk. Issues and receives tools, and runs departures operationally.", category: "warehouse", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "equipment", isSystem: true },
  { name: "procurement", description: "Buys equipment and materials. Reads the register, does not move custody.", category: "procurement", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "none", isSystem: true },
  /* The two leadership roles, and the only two seeded with `claimTierNames`.
     They pick the jobs they run; everybody below them is placed by somebody
     above through "Set by". The tier names must exist in `teamRoleSpecs`. */
  { name: "director", description: "Leads the business unit. Claims the jobs they run, then staffs them.", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "equipment", claimTierNames: ["director"], isSystem: true },
  { name: "area_in_charge", description: "Runs an area's jobs. Claims their own, and places PMs and superintendents on them.", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "equipment", claimTierNames: ["area_in_charge"], isSystem: true },
  { name: "general_superintendent", description: "Runs an area's superintendents. Claims their own jobs, and staffs PMs and superintendents onto them.", needsLogin: true, canHoldCustody: true, usesFieldLayout: false, onboardingKind: "equipment", claimTierNames: ["general_superintendent"], isSystem: true },
  { name: "project_manager", description: "Owns a job commercially. Sees the tools on their own projects.", category: "pm", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "equipment", isSystem: true },
  { name: "engineer", description: "Runs work on a job. Same reach as a project manager where tools are concerned.", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "equipment", isSystem: true },
  { name: "superintendent", description: "Runs several crews, and holds tools directly when a job has no foreman yet.", category: "superintendent", needsLogin: true, canHoldCustody: true, usesFieldLayout: true, onboardingKind: "equipment", isSystem: true },
  { name: "foreman", description: "Runs a crew and carries the tools to the job. Holds custody.", category: "foreman", needsLogin: true, canHoldCustody: true, usesFieldLayout: true, onboardingKind: "none", isSystem: true },
  { name: "mechanic", description: "Works out of the shop and keeps tools there. Holds custody.", category: "mechanic", needsLogin: true, canHoldCustody: true, usesFieldLayout: true, onboardingKind: "equipment", isSystem: true },
  { name: "hr", description: "People records. No access to the register or to custody.", category: "hr", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "people", isSystem: true },
  { name: "finance", description: "Cost and value reporting across the register.", category: "finance", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "none", isSystem: true },
  { name: "read_only", description: "Sees the register and reports, changes nothing.", needsLogin: true, canHoldCustody: false, usesFieldLayout: false, onboardingKind: "none", isSystem: true },
  { name: "crew", description: "Works on site and can be handed tools. Does not sign in.", needsLogin: false, canHoldCustody: true, usesFieldLayout: false, onboardingKind: "equipment", isSystem: false },
];

/* `EmployeeSeed.role`'s nine-value vocabulary, mapped onto the role register —
   the seed's own input shape, matching what the import CSVs and the
   `employee.role` column both carry. Only `pm` needed renaming; everything
   else was already the same word. */
export const legacyEmployeeRoleToRole: Record<string, string> = {
  foreman: "foreman",
  superintendent: "superintendent",
  pm: "project_manager",
  equipment_admin: "equipment_admin",
  warehouse: "warehouse",
  mechanic: "mechanic",
  procurement: "procurement",
  hr: "hr",
  finance: "finance",
};

export const uomCategorySpecs: { code: string; name: string }[] = [
  { code: "length", name: "Length" },
  { code: "area", name: "Area" },
  { code: "volume", name: "Volume" },
  { code: "mass", name: "Mass" },
  { code: "count", name: "Count" },
  { code: "time", name: "Time" },
  { code: "lump-sum", name: "Lump Sum" },
];

export const uomSpecs: { symbol: string; name: string; category: string }[] = [
  { symbol: "LF", name: "Linear Foot", category: "length" },
  { symbol: "FT", name: "Foot", category: "length" },
  { symbol: "YD", name: "Yard", category: "length" },
  { symbol: "SF", name: "Square Foot", category: "area" },
  { symbol: "SY", name: "Square Yard", category: "area" },
  { symbol: "AC", name: "Acre", category: "area" },
  { symbol: "CY", name: "Cubic Yard", category: "volume" },
  { symbol: "GAL", name: "Gallon", category: "volume" },
  { symbol: "TON", name: "Ton", category: "mass" },
  { symbol: "LB", name: "Pound", category: "mass" },
  { symbol: "EA", name: "Each", category: "count" },
  { symbol: "HR", name: "Hour", category: "time" },
  { symbol: "LS", name: "Lump Sum", category: "lump-sum" },
];

/*
  Company roles — the job title HR uses. Distinct from `employee.role`, which is
  the operational role the system branches on; see `company_role` in the schema.
  Seeded so the join on `employee.company_role_id` has something to resolve.
*/
/*
  The job-function tiers, and the ladder they form.

  `reportsTo` names another spec's `name`, resolved to an id in a second pass by
  the seed — the rows do not exist yet when this array is written, and a self
  reference cannot be satisfied in a single insert.

  A new tenant starts with exactly the three tiers `project_team_member.role`
  used to hardcode — pm, superintendent, foreman — as ordinary rows, no
  different in kind from one a tenant adds itself on `/settings/team-roles`.
  Director, Area In-charge and General Superintendent were Urban's own
  addition, made through that screen, not a second starting tier this seed
  ships — the next customer gets three rows and builds their own ladder from
  there, the same way Urban did.
*/
export type TeamRoleSeed = {
  name: string;
  label: string;
  canHoldCustody: boolean;
  reportsTo: string | null;
  /*
    Which tiers may FILL this one, held on the same job — `team_role_assigner`.

    Distinct from `reportsTo`, and frequently not the same tier: `reportsTo`
    says who this tier answers to, this says who may put somebody into it. A
    foreman answers to a superintendent AND is filled by one, but on a job with
    no superintendent the PM has to be able to fill it too, so the two lists
    diverge.

    Load-bearing since 2026-09-10. The dedicated `project.assign.*` permissions
    that used to grant this tenant-wide were removed, so a tier seeded with an
    empty list can be filled by nobody except an account holding
    `project.team.assign`.
  */
  setBy: string[];
};
/*
  Urban's real chain, as the client drew it on 2026-09-09.

  A DIAMOND, not a line. PM and superintendent are SIBLINGS under the area
  in-charge — the client corrected an earlier version that had superintendent
  reporting to pm, and the correction matters: neither outranks the other, and
  a rank number could not express that. `reportsToTeamRoleId` records an edge
  precisely so two tiers can share a boss.

  Project engineer, field engineer and foreman likewise sit together beneath
  the superintendent — the sketch has them on one line. All three carry tools,
  so all three hold custody.

  The tenant edits these on the Team Roles screen; this is the starting shape,
  not a fixed vocabulary. The next customer's chain will not be this one.
*/
export const teamRoleSpecs: TeamRoleSeed[] = [
  /* THE TOP OF THE CHAIN, and the only tier nobody can be placed into: a
     director puts themselves on a job by claiming it. */
  { name: "director", label: "Director", canHoldCustody: false, reportsTo: null, setBy: [] },
  /* A director staffs the two tiers directly beneath them — the client's own
     words on 2026-09-10: "directors assigns general superintendents (gsupers)
     & area-incharge". An area in-charge can also arrive by claiming, which is
     why the tier carries a claim grant as well as a `setBy` list; the two are
     different routes onto a job and both are wanted. */
  { name: "area_in_charge", label: "Area In-charge", canHoldCustody: false, reportsTo: "director", setBy: ["director"] },
  /* "area-incharge or gsupers assigns pm and superintendent" — so a general
     superintendent is placed by a director or an area in-charge, and may then
     staff the tiers below. It also claims, because a job may have a general
     superintendent running it with no area in-charge above them on that job. */
  { name: "general_superintendent", label: "General Superintendent", canHoldCustody: true, reportsTo: "area_in_charge", setBy: ["director", "area_in_charge"] },
  { name: "pm", label: "Project Manager", canHoldCustody: false, reportsTo: "area_in_charge", setBy: ["area_in_charge", "general_superintendent"] },
  { name: "superintendent", label: "Superintendent", canHoldCustody: true, reportsTo: "area_in_charge", setBy: ["area_in_charge", "general_superintendent"] },
  /* The bottom row is filled by whoever runs the job. The PM is included
     alongside the superintendent because a job flatter than the ladder — no
     superintendent on it at all — is normal and legal, and without this the
     PM could staff nothing on such a job. */
  { name: "project_engineer", label: "Project Engineer", canHoldCustody: true, reportsTo: "superintendent", setBy: ["superintendent", "pm", "general_superintendent"] },
  { name: "field_engineer", label: "Field Engineer", canHoldCustody: true, reportsTo: "superintendent", setBy: ["superintendent", "pm", "general_superintendent"] },
  { name: "foreman", label: "Foreman", canHoldCustody: true, reportsTo: "superintendent", setBy: ["superintendent", "pm", "general_superintendent"] },
];

export const companyRoleSpecs: { name: string; code: string }[] = [
  { name: "Foreman", code: "FRMN" },
  { name: "Superintendent", code: "SUPT" },
  { name: "Project Manager", code: "PM" },
  { name: "Equipment Manager", code: "EQMGR" },
  { name: "Mechanic", code: "MECH" },
  { name: "Operator", code: "OPER" },
  { name: "Carpenter", code: "CARP" },
  { name: "Labourer", code: "LABR" },
  { name: "Yard Hand", code: "YARD" },
];

