/*
  THE PERMISSION MATRIX, in code.

  This file is the single place the role -> permission mapping is written down
  (STI-308 acceptance criterion 4). `seed.ts` writes it into `role_permission`;
  `rbac-matrix.test.ts` asserts the database matches it in BOTH directions. If
  the test kept its own copy the two would drift and the test would start
  asserting history rather than policy — which is exactly how
  docs/workings/PERMISSION_MATRIX.md and the seed ended up a whole column apart.

  The prose version, with the reasoning and the questions still open with
  Urban, is docs/workings/PERMISSION_MATRIX.md. When the two disagree, THIS
  file is what the system does.
*/
import { PERMISSIONS, ROLES } from "@stinventory/types";

/* Shared by `project_manager` and `engineer` — see PERMISSION_MATRIX §1. */
export const PM_PERMS = [
  "asset.read", "project.read", "project.manage", "employee.read", "report.read",
  "assignment.read", "transfer.read", "location.read", "vehicle.read",
  "notification.read",
  /* PMs assign superintendents and foremen to their projects. */
  "project.team.read",
  "project.assign.superintendent",
  "project.assign.foreman",
  /* Their projects' tools, resolved through project_team_member and the job
     groups handed to the account. Not everything — a PM on two jobs sees two
     jobs' tools. */
  "assets.view.project",
] as const;

/*
  RBAC: the permission set per login role.

  This table is the executable half of `docs/workings/PERMISSION_MATRIX.md` §2.
  STI-308 asserts the two match in BOTH directions, so a permission added here
  and not there — or there and not here — fails the build rather than drifting
  quietly, which is how the two got a whole column apart the first time.

  Where the matrix and the shipped grants disagreed on 2026-08-22 the SHIPPED
  grant won (CLAUDE.md behaviour rule 3: the code is the truth about the
  running system, and the matrix is still a proposal Urban has not returned).
  The one exception is `notification.read`, which the matrix grants to all
  thirteen roles and the seed simply had not been filled in for — an omission,
  not a decision. Every delta is listed in PERMISSION_MATRIX.md §4.
*/
export const ROLE_PERMS: Record<(typeof ROLES)[number], readonly string[]> = {
  /* System Administrator. `owner` is that role — see the note on ROLES in
     packages/types. Everything, including config.manage. */
  owner: [...PERMISSIONS],
  /* Equipment Administrator: owns the small tools programme end to end. The
     matrix grants the same set as System Admin, and the two are kept as
     separate roles because SYSTEM_PLAN §2 forbids collapsing "Admin" into one
     name — not because their grants differ today. */
  equipment_admin: [...PERMISSIONS],
  /*
    Office Administrator: operations, accounts, general business
    administration. Business records — NOT custody, NOT platform config.

    Deliberately WITHOUT `config.manage`, which is PERMISSION_MATRIX §5
    decision 4 taken at its default. That permission is also what gates the LLM
    configuration and the high-value approval threshold, so granting it here to
    let an office administrator add a user would also hand them the power to
    change what needs a second signature. Splitting `config.manage` into a
    separate `user.manage` is the alternative and it is a real change, not a
    rename — it is not made on a default.

    Consequence, stated plainly: an Office Administrator CANNOT create users or
    reset passwords. If Urban wants that, answer question 8.
  */
  office_admin: [
    "asset.read",
    "assignment.read",
    "transfer.read",
    "location.read",
    "vehicle.read",
    "project.read",
    "project.manage",
    "project.team.read",
    /* Placing a PM on a job reads as an administrative act (§5 decision 3,
       default taken). Placing supers and foremen does not — that is the job
       of whoever runs the work. */
    "project.assign.pm",
    "employee.read",
    "employee.manage",
    "department.read",
    "report.read",
    "audit.read",
    "notification.read",
    "assets.view.all",
  ],
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
    "transfer.read",
    "transfer.create",
    /* The yard desk runs departures operationally (STI-306). `owner` and
       `equipment_admin` get it through the spread above. Deliberately NOT
       granted to PM, Engineer, superintendent or HR: whether the person who
       DISCOVERS a departure should be able to act on it is PERMISSION_MATRIX
       §5 decision 1, and its default is "leave it as shipped" — a bulk custody
       move stays in the fewest hands until Urban widens it. */
    "custody.reassign",
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
    "assets.view.all",
  ],
  superintendent: [
    "asset.read", "location.read", "vehicle.read", "project.read", "employee.read",
    "assignment.read", "assignment.create", "assignment.approve",
    "transfer.read", "transfer.create", "transfer.approve",
    "report.read", "notification.read",
    /* Superintendents put foremen on their projects. */
    "project.team.read",
    "project.assign.foreman",
    /* Sees what the foremen reporting to them are holding — resolved through
       employee.reportsToEmployeeId, not through project membership. A
       superintendent whose crew works three jobs sees all three. */
    "assets.view.crew",
  ],
  procurement: ["asset.read", "project.read", "employee.read", "report.read", "notification.read", "assets.view.all"],
  project_manager: PM_PERMS,
  /* Engineer: the same authority as a Project Manager where small tools are
     concerned (PERMISSION_MATRIX §1). Shares the constant rather than
     retyping it, so the two cannot drift apart by editing one list — if they
     ever genuinely diverge, that is the moment to write this set out in full
     and say why. */
  engineer: PM_PERMS,
  /* Read-only on custody by design. Tools are issued and reassigned by the
     equipment desk; a foreman sees what he is holding and what is coming, and
     tells the desk through chat or a request when something needs to move. He
     used to hold assignment.create and transfer.create, which is what made a
     foreman-to-foreman borrow possible — see the 2026-08-09 changelog. */
  foreman: [
    "asset.read",
    "location.read",
    "vehicle.read",
    "project.read",
    "employee.read",
    "assignment.read",
    "transfer.read",
    "report.read",
    "notification.read",
    /* A foreman can see who else is on the project they work. The matrix
       proposes withdrawing this; the shipped grant wins until Urban says
       otherwise (PERMISSION_MATRIX §4). */
    "project.team.read",
    /* What is in his own hands, and nothing else. */
    "assets.view.own",
  ],
  /*
    Mechanic: a custodian like a foreman, but for repair and maintenance rather
    than construction. `CUSTODIAN_ROLES` has included `mechanic` since before
    this role could log in — the person existed in the register, the account
    did not.

    No `project.read`: a mechanic works out of the yard, and their custody
    charges the Equipment DEPARTMENT rather than a project, which is why
    `department.read` is here instead. PERMISSION_MATRIX §5 decision 2 flags
    `assets.view.own` as "the line in this document most likely to be wrong" —
    the alternative is a department-wide view. Default taken; cheap to widen.
  */
  mechanic: [
    "asset.read",
    "location.read",
    "vehicle.read",
    "employee.read",
    "department.read",
    "assignment.read",
    "transfer.read",
    "report.read",
    "notification.read",
    "assets.view.own",
  ],
  hr: ["employee.read", "employee.manage", "notification.read", "report.read", "project.team.read", "assets.view.all"],
  finance: ["asset.read", "project.read", "report.read", "audit.read", "notification.read", "assets.view.all"],
  read_only: [
    "asset.read", "location.read", "vehicle.read", "project.read", "employee.read",
    "report.read", "notification.read", "assets.view.all",
  ],
};
