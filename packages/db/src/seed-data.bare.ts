/*
  The EMPTY register — a tenant with nobody and nothing in it.

  The third dataset, and the only one that seeds no people. It exists because
  BambooHR became the source of truth for who works here: once the sync is the
  thing that creates employees, a seeded roster is not a convenience, it is
  forty-six invented people standing between a real sync and an honest answer to
  "did that work". The demo fixture and Urban's real register both still make
  sense for what they are — see the comment at the top of `seed.ts` — but
  neither is what you want in front of a live integration.

  What this DOES seed is everything a tenant cannot function without and no
  sync will ever supply:

    - the tenant row and its settings
    - permissions, roles and the role-permission matrix
    - the static vocabularies: categories, departments, divisions, company
      roles (job titles), team roles, units of measure
    - ONE owner login, so somebody can sign in and press Sync

  Everything downstream of a person is empty by construction. Not "seeded
  empty" as a special case in `seed.ts` — the arrays below are genuinely
  empty, so every loop in the seed runs zero times and no code path needs a
  branch. That is the whole design: `SEED_DATASET=bare` changes the DATA, not
  the program.

  Two consequences worth knowing before you pick this:

  - **The registers start empty.** No tools, no equipment, no projects, no
    custody. `/tools`, `/custody` and the dashboard render their empty states,
    which is correct but is not a demo.
  - **The RBAC matrix tests cannot run against it.** They sign in as fifteen
    per-role accounts that only the demo fixture builds. Use `make seed-demo`
    before the test suite, exactly as its help text already says.

  The owner's password comes from SEED_OWNER_PASSWORD, or is generated and
  printed once — the same rule the Urban dataset follows, and for the same
  reason: a credential in git is a credential on the internet.
*/
import type {
  AssetSeed,
  AssignSeed,
  EmployeeSeed,
  LocSeed,
  PostingSeed,
  ProjectSeed,
  TeamSeed,
  TxSeed,
  UserSeed,
  VehLocSeed,
  VehSeed,
} from "./seed-data.js";

/* Everything below is deliberately empty. Do not "helpfully" add a sample row:
   the point of this dataset is that a person in the People register came from
   BambooHR, and one seeded example makes that untrue again. */

export const projectSpecs: ProjectSeed[] = [];
export const employeeSpecs: EmployeeSeed[] = [];
export const postingSpecs: PostingSeed[] = [];
export const teamSpecs: TeamSeed[] = [];
export const locSpecs: LocSeed[] = [];
export const vehLocSpecs: VehLocSeed[] = [];
export const vehSpecs: VehSeed[] = [];
export const assetSpecs: AssetSeed[] = [];
export const assignSpecs: AssignSeed[] = [];
export const txSpecs: TxSeed[] = [];

/*
  ONE account, and it is the SAME address the urban dataset seeds —
  `optix_it@optixtec.com`, holding `owner`. Deliberately not a new name: this is
  the administrator Urban already knows, and inventing a second "owner@" for the
  empty dataset would mean two spellings of the same person depending on which
  seed ran.

  `owner` rather than `tech_admin`. Their GRANTS are identical — both are
  `[...PERMISSIONS]` in `role-perms.ts`, so either could sync — and what
  separates them is `role.is_cross_tenant`, which reaches every tenant and which
  NOTHING READS YET. The honest choice is the role that means "the organisation's
  own administrator", because that is what this account is: it configures the
  BambooHR key, presses Sync, and holds `config.manage`.

  (`tech_admin` exists for Optix's own operator and the urban dataset seeds one
  alongside the owner. This dataset does not, because an empty tenant handed to a
  customer does not need Optix's operator account sitting in its user list.)

  `employeeKey: null` on purpose: this account has no employee record, which is a
  supported and already-exercised state — `user.employee_id` is nullable and every
  employeeId-scoped query has a second branch for it. Binding it to a seeded
  person would mean seeding a person, which is the thing this dataset exists to
  avoid. It also stays true after the sync: an administrator is not somebody who
  holds tools, and BambooHR has no reason to know about them.
*/
export const userSpecs: UserSeed[] = [
  { email: "optix_it@optixtec.com", first: "Optix", last: "IT", role: "owner", employeeKey: null },
];
