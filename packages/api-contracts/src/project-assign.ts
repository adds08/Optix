import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
import { moveCustody } from "./custody.js";

/* The employee roles that map straight onto a project-team role when the
   caller says "auto". A named list rather than a chain of `||` comparisons —
   STI-307's rule for the branches that legitimately read domain data. */
const TEAM_ROLE_FROM_EMPLOYEE = ["pm", "superintendent", "foreman"] as const;

/*
  Move a person to a project — the shared engine behind `employee.assignToProject`
  and `project.team.assign` for a foreman.

  The rule this encodes is the one that makes small tools different from heavy
  equipment: tools belong to the foreman, not the site. When a foreman moves
  job, everything in their custody moves with them, so the operational project
  on each tool has to follow or every "what is on Legacy West?" report goes
  stale the day somebody transfers.

  Three things change, in one transaction:
    1. the open posting closes and a new one opens (the backtrack),
    2. `employee.primaryProjectId` catches up (the fast answer),
    3. every tool they hold — and the trucks/trailers that carry them — gets
       `currentProjectId` moved, with a `project_change` event each so the
       ledger can still rebuild it.

  `owningProjectId` is deliberately untouched. Whoever's capital bought the
  tool keeps paying for it; moving job does not re-charge it. That split is
  the whole point of having two project columns.

  When `role` is given, the person's current team row is kept in lockstep:
  linking a foreman to a project in the team roster IS "they are working there
  now", so the roster must never disagree with the posting. Rows are closed
  with `endedOn`, never deleted.
*/

export type MoveResult = {
  postingId: string | null;
  toolsMoved: number;
  containersMoved: number;
  employeeName: string;
  projectName: string;
};

export async function moveEmployeeToProject(
  db: any,
  args: {
    tenantId: string;
    employeeId: string;
    projectId: string;
    actorUserId: string | null;
    startedOn?: string;
    note?: string | null;
    /* Off only for a correction — posting somebody retroactively where their
       tools already moved by hand. */
    moveTools?: boolean;
    /* Only meaningful when `moveTools` is false, and it is the difference
       between the two reasons somebody says "no".

       A CORRECTION means "the tools are already right, do not touch them" —
       that is plain `moveTools: false`, and it writes nothing.

       A DELIBERATE HAND-BACK means "this person is leaving the job and the
       tools are staying on it". Left alone, those tools would keep the
       departing person as custodian while they work somewhere else, so the
       register would name a holder who is no longer there — the same failure
       STI-306 was written for, arriving through a different door. This
       releases them instead: custodian cleared, project and location kept, so
       they land in the "nobody holding" state the jobsite cards already draw. */
    releaseToolsInPlace?: boolean;
    /* On by default the other way: a foreman's trucks, and the trailers
       hitched to them, go to the new job with the tools — the tools physically
       live in them. Turn this on to leave the trailer (and its tools) behind;
       the trucks still follow, because the foreman drives them. */
    leaveContainers?: boolean;
    /* When given, keep the person's project_team_member row for this role in
       lockstep (close on any other project, open on this one). `"auto"` uses
       the person's own role when it is a team role. */
    role?: "pm" | "superintendent" | "foreman" | "auto";
    /* Stamped on the roster row this opens. Descriptive provenance only — see
       TEAM_SOURCES in packages/types. */
    source?: string;
  },
): Promise<MoveResult> {
  const {
    tenantId: tid,
    employeeId,
    projectId,
    actorUserId,
    note,
    moveTools = true,
    releaseToolsInPlace = false,
    leaveContainers = false,
    role,
    source = "equipment_department",
  } = args;
  const startedOn = args.startedOn ?? new Date().toISOString().slice(0, 10);

  const [person] = await db
    .select({
      id: schema.employee.id,
      name: schema.employee.name,
      primaryProjectId: schema.employee.primaryProjectId,
      role: schema.employee.role,
    })
    .from(schema.employee)
    .where(and(eq(schema.employee.id, employeeId), eq(schema.employee.tenantId, tid)));
  if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "No such person in this tenant" });

  /* STI-307 — DOMAIN DATA, not authorisation. `person.role` is the employee
     register's answer to "what kind of worker is this", and "auto" means
     "infer the team role from that". It is not a permission check: the caller's
     authority is decided by `project.assign.*` in projectTeam.assertCanAssign,
     which runs before anything here. Routed through TEAM_ROLE_FROM_EMPLOYEE so
     adding a team role is one edit rather than a three-way `||` somebody has
     to notice. */
  const teamRole =
    role === "auto"
      ? (TEAM_ROLE_FROM_EMPLOYEE as readonly string[]).includes(person.role)
        ? (person.role as (typeof TEAM_ROLE_FROM_EMPLOYEE)[number])
        : undefined
      : role;

  const [proj] = await db
    .select({ id: schema.project.id, name: schema.project.name })
    .from(schema.project)
    .where(and(eq(schema.project.id, projectId), eq(schema.project.tenantId, tid)));
  if (!proj) throw new TRPCError({ code: "NOT_FOUND", message: "No such project in this tenant" });

  const result = await db.transaction(async (tx: any) => {
    /* Close whatever is open. Ending on the same day the next posting starts
       keeps the history contiguous — a gap would read as time the person was
       on no job at all. */
    await tx
      .update(schema.employeeProjectAssignment)
      .set({ endedOn: startedOn })
      .where(
        and(
          eq(schema.employeeProjectAssignment.tenantId, tid),
          eq(schema.employeeProjectAssignment.employeeId, employeeId),
          isNull(schema.employeeProjectAssignment.endedOn),
        ),
      );

    const [posting] = await tx
      .insert(schema.employeeProjectAssignment)
      .values({
        tenantId: tid,
        employeeId,
        projectId,
        startedOn,
        assignedByUserId: actorUserId,
        note: note ?? null,
      })
      .returning();

    await tx
      .update(schema.employee)
      .set({ primaryProjectId: projectId })
      .where(and(eq(schema.employee.id, employeeId), eq(schema.employee.tenantId, tid)));

    /*
      The roster row follows the posting, so the Tools by Jobsite hub and the
      people screen never disagree about where a foreman is working.

      The lockstep is foreman-only: a foreman works one project at a time, so
      their row on every OTHER project closes when they move. A PM or
      superintendent runs several jobs at once (their roster rows are created
      by project.team.assign, which never moves tools), so a posting change
      must not collapse those rows — only the target project's row is
      refreshed.
    */
    if (teamRole) {
      if (teamRole === "foreman") {
        await tx
          .update(schema.projectTeamMember)
          .set({ endedOn: startedOn })
          .where(
            and(
              eq(schema.projectTeamMember.tenantId, tid),
              eq(schema.projectTeamMember.employeeId, employeeId),
              eq(schema.projectTeamMember.role, teamRole),
              isNull(schema.projectTeamMember.endedOn),
              notInArray(schema.projectTeamMember.projectId, [projectId]),
            ),
          );
      }
      await tx
        .update(schema.projectTeamMember)
        .set({ endedOn: startedOn })
        .where(
          and(
            eq(schema.projectTeamMember.tenantId, tid),
            eq(schema.projectTeamMember.projectId, projectId),
            eq(schema.projectTeamMember.employeeId, employeeId),
            eq(schema.projectTeamMember.role, teamRole),
            isNull(schema.projectTeamMember.endedOn),
          ),
        );
      await tx
        .insert(schema.projectTeamMember)
        .values({
          tenantId: tid,
          projectId,
          employeeId,
          role: teamRole,
          assignedByUserId: actorUserId,
          startedOn,
          note: note ?? null,
          source,
        });
    }

    if (!moveTools) {
      if (!releaseToolsInPlace) return { postingId: posting?.id ?? null, toolsMoved: 0, containersMoved: 0 };

      /*
        Hand the tools back to the job rather than dragging them to the new one.

        Only what the person holds DIRECTLY. Tools merely aboard their truck or
        trailer are not touched: the rig leaves with them, and a tool inside a
        departing trailer has not been left behind in any sense a yard would
        recognise.

        Through `moveCustody` because this changes the CUSTODIAN, which the
        project-change path below never does — that one rewrites a project
        column and is legitimately not a custody write. This one is, and
        custody.ts is the only writer allowed to close a link.

        Truck and trailer are stamped explicitly null: the rig is going to the
        new job with its owner, so the tool is demonstrably no longer riding on
        it. Both keys are emitted as affirmative nulls rather than omitted, per
        the shape-boundary rule in packages/domain/src/fold.ts — an absent key
        folds to "not recorded" and a rebuild would keep quoting the old rig.
      */
      const holding = await tx
        .select({
          id: schema.asset.id,
          currentStatus: schema.asset.currentStatus,
          currentCustodianId: schema.asset.currentCustodianId,
          currentProjectId: schema.asset.currentProjectId,
          currentLocationId: schema.asset.currentLocationId,
        })
        .from(schema.asset)
        .where(
          and(
            eq(schema.asset.tenantId, tid),
            eq(schema.asset.currentCustodianId, employeeId),
            notInArray(schema.asset.currentStatus, ["lost", "disposed"]),
          ),
        );

      for (const a of holding) {
        /* `assigned` is the one status that is a statement about a custodian,
           so it cannot survive the custodian being cleared. Everything else is
           a statement about the tool — a spanner in for repair is still in for
           repair the moment its holder changes job — and is carried, the same
           reasoning departure.ts applies when it refuses to stamp a status. */
        const status = a.currentStatus === "assigned" ? "available" : a.currentStatus;

        await moveCustody(tx, {
          tenantId: tid,
          assetId: a.id,
          toCustodianId: null,
          projectId: a.currentProjectId,
          locationId: a.currentLocationId,
          truckId: null,
          trailerId: null,
          actorUserId,
          closeAs: "returned",
        });

        await tx
          .update(schema.asset)
          .set({ currentCustodianId: null, currentStatus: status, updatedAt: new Date() })
          .where(and(eq(schema.asset.id, a.id), eq(schema.asset.tenantId, tid)));

        await tx.insert(schema.transaction).values({
          tenantId: tid,
          assetId: a.id,
          eventType: "custodian_change",
          actorId: actorUserId,
          fromState: {
            status: a.currentStatus,
            custodianId: a.currentCustodianId,
            projectId: a.currentProjectId,
            locationId: a.currentLocationId,
          },
          toState: {
            status,
            custodianId: null,
            projectId: a.currentProjectId,
            locationId: a.currentLocationId,
            truckId: null,
            trailerId: null,
          },
          refType: "employee_project_assignment",
          refId: posting?.id ?? null,
          note: `Left on the job when ${person.name} moved to ${proj.name}`,
        });
      }

      return { postingId: posting?.id ?? null, toolsMoved: holding.length, containersMoved: 0 };
    }

    /* Lost and disposed tools stay where the record says they were lost.
       Dragging them onto the new job would quietly rewrite where a police
       report has to point. */
    const held = await tx
      .select({
        id: schema.asset.id,
        tag: schema.asset.tag,
        currentStatus: schema.asset.currentStatus,
        currentCustodianId: schema.asset.currentCustodianId,
        currentProjectId: schema.asset.currentProjectId,
        currentLocationId: schema.asset.currentLocationId,
      })
      .from(schema.asset)
      .where(
        and(
          eq(schema.asset.tenantId, tid),
          eq(schema.asset.currentCustodianId, employeeId),
          notInArray(schema.asset.currentStatus, ["lost", "disposed"]),
        ),
      );

    /* The foreman's trucks follow, and the trailers hitched to them — a
       trailer attached to the truck rides with it. Tools are usually in the
       trailer, so "the truck goes to the new job" has to take them along or
       every tool on the old site would stay booked to a job nobody is running. */
    const vehicles = await tx
      .select({
        id: schema.vehicle.id,
        vehicleType: schema.vehicle.vehicleType,
        locationId: schema.vehicle.locationId,
      })
      .from(schema.vehicle)
      .where(and(eq(schema.vehicle.tenantId, tid), eq(schema.vehicle.foremanEmployeeId, employeeId)));

    /* The rig follows the person: every truck AND every directly-held trailer
       (a trailer assigned to them without a truck) travels with them, plus any
       trailer hitched to one of those trucks. */
    const heldLocIds = vehicles.map((v: any) => v.locationId); // foremanEmployeeId = employee
    const truckLocIds = vehicles.filter((v: any) => v.vehicleType === "truck").map((v: any) => v.locationId);
    const containerLocIds = new Set<string>(heldLocIds);
    if (!leaveContainers) {
      const trailerLocIds = vehicles.filter((v: any) => v.vehicleType === "trailer").map((v: any) => v.locationId);
      if (trailerLocIds.length) {
        const trailerLocs = await tx
          .select({ id: schema.location.id, parentLocationId: schema.location.parentLocationId })
          .from(schema.location)
          .where(and(eq(schema.location.tenantId, tid), inArray(schema.location.id, trailerLocIds)));
        for (const t of trailerLocs) {
          /* Only trailers actually hitched to one of the foreman's trucks ride
             along — a trailer attached to somebody else's truck stays with
             that truck. */
          if (t.parentLocationId && truckLocIds.includes(t.parentLocationId)) {
            containerLocIds.add(t.id);
          }
        }
      }
    }

    const aboard = containerLocIds.size
      ? await tx
          .select({
            id: schema.asset.id,
            tag: schema.asset.tag,
            currentStatus: schema.asset.currentStatus,
            currentCustodianId: schema.asset.currentCustodianId,
            currentProjectId: schema.asset.currentProjectId,
            currentLocationId: schema.asset.currentLocationId,
          })
          .from(schema.asset)
          .where(
            and(
              eq(schema.asset.tenantId, tid),
              inArray(schema.asset.currentLocationId, [...containerLocIds]),
              notInArray(schema.asset.currentStatus, ["lost", "disposed"]),
            ),
          )
      : [];

    /* One tool, one entry: something the foreman holds directly and is also
       aboard a following truck is not moved twice. */
    const byId = new Map<string, any>();
    for (const a of held) byId.set(a.id, a);
    for (const a of aboard) byId.set(a.id, a);
    const moving = [...byId.values()].filter((a: any) => a.currentProjectId !== projectId);

    let toolsMoved = 0;
    if (moving.length) {
      const ids = moving.map((a: any) => a.id);

      await tx
        .update(schema.asset)
        .set({ currentProjectId: projectId, updatedAt: new Date() })
        .where(and(eq(schema.asset.tenantId, tid), inArray(schema.asset.id, ids)));

      /* Open custody links carry the project too, so the custody screen does
         not keep showing the job they just left. */
      await tx
        .update(schema.assignment)
        .set({ projectId, updatedAt: new Date() })
        .where(
          and(
            eq(schema.assignment.tenantId, tid),
            eq(schema.assignment.status, "active"),
            inArray(schema.assignment.assetId, ids),
          ),
        );

      await tx.insert(schema.transaction).values(
        moving.map((a: any) => ({
          tenantId: tid,
          assetId: a.id,
          eventType: "project_change",
          actorId: actorUserId,
          fromState: {
            status: a.currentStatus,
            custodianId: a.currentCustodianId,
            projectId: a.currentProjectId,
            locationId: a.currentLocationId,
          },
          /* Complete snapshot — the fold is last-snapshot-wins, so a partial
             toState would blank out custody and location. */
          toState: {
            status: a.currentStatus,
            custodianId: a.currentCustodianId,
            projectId,
            locationId: a.currentLocationId,
          },
          refType: "employee_project_assignment",
          refId: posting?.id ?? null,
          note: `Moved with ${person.name} to ${proj.name}`,
        })),
      );
      toolsMoved = moving.length;
    }

    /* The containers themselves re-home to the new job so the locations page
       and the register agree about where the truck works. */
    let containersMoved = 0;
    if (containerLocIds.size) {
      await tx
        .update(schema.location)
        .set({ projectId })
        .where(and(eq(schema.location.tenantId, tid), inArray(schema.location.id, [...containerLocIds])));
      await tx
        .update(schema.vehicle)
        .set({ projectId, updatedAt: new Date() })
        .where(and(eq(schema.vehicle.tenantId, tid), inArray(schema.vehicle.locationId, [...containerLocIds])));
      containersMoved = containerLocIds.size;
    }

    return { postingId: posting?.id ?? null, toolsMoved, containersMoved };
  });

  return { ...result, employeeName: person.name, projectName: proj.name };
}
