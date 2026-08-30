import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import type { Database, Transaction } from "@stinventory/db";
import * as schema from "@stinventory/db/schema";
import { formatAssetModel, type VehicleOwnership } from "@stinventory/types";
import { projectForCustodian, moveCustody, vehicleContextFromLedger } from "./custody.js";
/* The one writer that knows what handing a container over means — custodian
   column, vehicle mirror, and the contents that ride inside it. A departure is
   a container hand-over with a reason attached, not a second kind of one. */
import { applyContainerCustody } from "./routers/location.js";

/*
  A departure, moved in one auditable action (STI-306).

  Termination used to stamp a date and nothing else: the clearance queue could
  tell you an ex-employee was still holding nineteen tools and offered no way
  to act on it, so the tools stayed on a name that no longer works here and
  every downstream reader — capital per foreman, tools-follow-the-foreman, the
  queue itself — kept quoting that name. Moving them one at a time through the
  assignment form is how a mistake becomes forty ledger events, which is why
  the preview below exists and why the move is one transaction: either every
  item lands on the successor or nothing does.

  DELIBERATELY OUT OF SCOPE: deactivating the leaver's login. The plan's
  pseudocode ends with `tx.deactivate_user(leaver)`, but that is STI-303, most
  employees have no account at all, and "who holds the tools" and "who can log
  in" are two decisions that should not be welded together in the first
  version — a botched account close must not roll back a completed hand-over.

  All custody writes go through custody.ts. Nothing here inserts, updates or
  closes an `assignment` row itself, and nothing here hands a container over
  itself either — that is `applyContainerCustody`'s job, for the reason on the
  container loop below.
*/

/*
  The ONE place the ownership literal is written.

  The plan's pseudocode compares against 'company' | 'personal'. Neither string
  exists in the column — the real values are `company_owned | personal_allowance`
  (packages/db/src/schema/location.ts) — and a mismatch here does not throw:
  `ownershipType !== "personal"` is true of every row, so the check silently
  hands somebody's own truck to their replacement. `satisfies` makes that typo
  a compile error instead, and `departure.test.ts` asserts the value against
  the shared enum.
*/
export const PERSONAL_VEHICLE = "personal_allowance" satisfies VehicleOwnership;

/*
  Held tools only, and "held" here means EXACTLY what the clearance queue means
  by it: `current_status != 'available'`. Both `dashboard.clearanceQueue` and
  the `clearanceCount` behind the HR card use that one predicate
  (routers/dashboard.ts) and nothing else.

  This list read `["available", "lost", "disposed"]` and claimed to be the
  queue's predicate. It was not, and the gap was not cosmetic: a terminated
  foreman holding one `lost` tool showed 1 on the clearance card and 0 in this
  preview, so the operator was told there was nothing to move while the card
  kept nagging — and because nothing moved the tool off his name, that queue
  entry could never be cleared by this action at all. A screen reached from a
  queue must agree with the queue it was reached from.

  So lost and disposed tools DO move, and the argument for excluding them —
  "the record of where a tool went missing must not follow the leaver's
  replacement around" — is answered by the ledger rather than by the
  projection: who lost it, and while holding it under whom, is written
  permanently in `transaction` and cannot be edited. `current_custodian_id`
  answers a narrower and more operational question — who do we ask about this
  tool NOW — and once the leaver is gone the honest answer to that is the
  successor. (`applyContainerCustody` still leaves lost/disposed tools inside a
  container alone: a hand-over of a box that a tool merely sits in is not the
  same event as the departure of the person accountable for it.)
*/
const NOT_HELD = ["available"];

export type DepartureTool = {
  assetId: string;
  tag: string | null;
  modelName: string | null;
  status: string | null;
  currentProjectId: string | null;
};

export type DepartureContainer = {
  locationId: string;
  locationName: string;
  vehicleId: string | null;
  unit: string | null;
  vehicleType: string | null;
  ownershipType: string | null;
};

export type SkippedContainer = DepartureContainer & { reason: string };

export type Successor = {
  id: string;
  name: string;
  role: string;
  /** `chosen` = the caller named them; `team` = resolved from the project team. */
  source: "chosen" | "team";
};

export type DeparturePreview = {
  leaver: { id: string; name: string; employmentStatus: string };
  successor: Successor | null;
  /* True when the reporting chain yielded nobody. The caller must then choose
     explicitly — see resolveSuccessor. */
  successorRequired: boolean;
  tools: DepartureTool[];
  containers: DepartureContainer[];
  skipped: SkippedContainer[];
};

/*
  Who takes the tools.

  Defaults to the leaver's project team, in the order the hierarchy is drawn:
  an active superintendent on the leaver's project first, then the PM(s) on
  that project. Engineers are covered by the PM arm — Urban's engineers are
  seeded as `employee.role = 'pm'` with a `pm` team row (seed-data.ts,
  `e-eng001`), so "PM or engineer" is one lookup, not two. Terminated links are
  stepped over rather than accepted — handing a departing foreman's tools to
  another departed employee re-creates the queue entry this action exists to
  clear.

  The leaver's project is their `primaryProjectId` (the fact the roster and the
  tools-follow-the-foreman engine keep current); if that is unset, the project
  named by their active `project_team_member` row is used. This is the SAME
  source the crew ladder now uses (2026-08-23): `reportsToEmployeeId` was
  removed as the source of the superintendent edge everywhere, including here —
  a manual org-chart link that could disagree with the roster is no longer the
  basis for putting tools on somebody.

  Returns null rather than guessing. There is no safe default at the top of the
  chain: picking "some active superintendent" would put a $12k plate compactor
  on a person nobody chose, and leaving the tools with the leaver is the bug.
  So the caller is made to choose, and the mutation refuses until they do.
*/
export async function resolveSuccessor(
  db: Database | Transaction,
  tenantId: string,
  leaver: { id: string; name: string; primaryProjectId: string | null },
  chosenId?: string | null,
): Promise<Successor | null> {
  if (chosenId) {
    if (chosenId === leaver.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `${leaver.name} cannot take over from themselves.` });
    }
    const emp = await db.query.employee.findFirst({
      where: and(eq(schema.employee.id, chosenId), eq(schema.employee.tenantId, tenantId)),
      columns: { id: true, name: true, role: true, employmentStatus: true },
    });
    if (!emp) throw new TRPCError({ code: "NOT_FOUND", message: "No such person in this tenant." });
    if (emp.employmentStatus !== "active") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${emp.name} is not an active employee. Tools cannot be moved onto somebody who has left.`,
      });
    }
    return { id: emp.id, name: emp.name, role: emp.role, source: "chosen" };
  }

  /* The leaver's project: primary first, then the project of their current
     team row. A foreman's tools follow the foreman, so where they WORKED is
     where the replacement must come from — not wherever `reportsTo` happened
     to point. */
  let projectIds: string[] = [];
  if (leaver.primaryProjectId) {
    projectIds = [leaver.primaryProjectId];
  } else {
    const rows = await db
      .select({ projectId: schema.projectTeamMember.projectId })
      .from(schema.projectTeamMember)
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, tenantId),
          eq(schema.projectTeamMember.employeeId, leaver.id),
          eq(schema.projectTeamMember.role, "foreman"),
          isNull(schema.projectTeamMember.endedOn),
        ),
      );
    projectIds = rows.map((r) => r.projectId);
  }
  if (projectIds.length === 0) return null;

  /* The ladder: superintendents on the leaver's project first, then the PMs
     (which covers engineers — Urban's engineers are seeded with employee role
     `pm` and a `pm` team row). Deterministic: first by the fixed role order,
     then by employee id, so the same departure always previews the same
     person. Never the leaver themselves. */
  const [supers, pms] = await Promise.all([
    activeTeamMembersOfRole(db, tenantId, projectIds, "superintendent", leaver.id),
    activeTeamMembersOfRole(db, tenantId, projectIds, "pm", leaver.id),
  ]);

  for (const id of [...supers, ...pms]) {
    const emp = await db.query.employee.findFirst({
      where: and(eq(schema.employee.id, id), eq(schema.employee.tenantId, tenantId)),
      columns: { id: true, name: true, role: true },
    });
    if (emp) return { id: emp.id, name: emp.name, role: emp.role, source: "team" };
  }
  return null;
}

/** Active employees holding `role` on any of `projectIds`, excluding `excludeId`, ordered by id. */
async function activeTeamMembersOfRole(
  db: Database | Transaction,
  tenantId: string,
  projectIds: string[],
  role: "superintendent" | "pm",
  excludeId: string,
): Promise<string[]> {
  const rows = await db
    .select({ employeeId: schema.projectTeamMember.employeeId })
    .from(schema.projectTeamMember)
    .innerJoin(schema.employee, eq(schema.employee.id, schema.projectTeamMember.employeeId))
    .where(
      and(
        eq(schema.projectTeamMember.tenantId, tenantId),
        eq(schema.projectTeamMember.role, role),
        eq(schema.employee.employmentStatus, "active"),
        isNull(schema.projectTeamMember.endedOn),
        inArray(schema.projectTeamMember.projectId, projectIds),
        notInArray(schema.projectTeamMember.employeeId, [excludeId]),
      ),
    )
    .orderBy(asc(schema.projectTeamMember.employeeId));
  return rows.map((r) => r.employeeId);
}

/** The tools the register says the leaver is holding, in a stable lock order. */
async function toolsHeldBy(db: Database | Transaction, tenantId: string, leaverId: string, lock: boolean) {
  const q = db
    .select({
      assetId: schema.asset.id,
      tag: schema.asset.tag,
      make: schema.asset.make,
      modelNumber: schema.asset.modelNumber,
      description: schema.asset.description,
      currentStatus: schema.asset.currentStatus,
      currentProjectId: schema.asset.currentProjectId,
      currentLocationId: schema.asset.currentLocationId,
      currentCustodianId: schema.asset.currentCustodianId,
    })
    .from(schema.asset)
    .where(
      and(
        eq(schema.asset.tenantId, tenantId),
        eq(schema.asset.currentCustodianId, leaverId),
        notInArray(schema.asset.currentStatus, NOT_HELD),
      ),
    )
    /* Ordered by id so every departure takes its row locks in the same
       sequence. Two departures that share a tool would otherwise be free to
       grab them in opposite orders and deadlock in the database. */
    .orderBy(asc(schema.asset.id));
  /* Locked up front, for the whole set, rather than relying on the per-asset
     lock moveCustody takes later: everything below reads these rows to build
     `fromState`, and a snapshot taken before the lock is a snapshot another
     writer can invalidate — the same read-then-act gap STI-109 closed on the
     decision procedures. Plain select from `asset`, no outer join, so FOR
     UPDATE is legal here. */
  return lock ? q.for("update") : q;
}

/*
  Containers recorded against the leaver — trailers, trucks, gang boxes.

  Selected from `location` (the authoritative custodian column) with the
  vehicle row joined on, so a gang box, which has no vehicle row at all, is
  found by the same query and always moves: there is no such thing as a
  personal gang box.

  The second arm catches drift in `vehicle.foremanEmployeeId`, the mirror the
  vehicle list and the import still read — but ONLY where the authoritative
  column has no answer at all. A stale mirror must never overrule a live one:
  if the location row says a trailer is Bob's and the mirror still says the
  leaver's, taking it off Bob is a worse outcome than leaving one stale mirror
  column, and Bob is still employed to notice. Where the location row is
  silent, writing both on the way out re-syncs them.

  Hitched trailers are NOT followed here, unlike location.setCustodian. A hitch
  says where a trailer is parked, not who it is booked to, and a departure must
  not quietly move a trailer that is recorded against somebody who is still
  employed.
*/
async function containersHeldBy(db: Database | Transaction, tenantId: string, leaverId: string) {
  return db
    .select({
      locationId: schema.location.id,
      locationName: schema.location.name,
      vehicleId: schema.vehicle.id,
      unit: schema.vehicle.unit,
      vehicleType: schema.vehicle.vehicleType,
      ownershipType: schema.vehicle.ownershipType,
    })
    .from(schema.location)
    .leftJoin(
      schema.vehicle,
      and(eq(schema.vehicle.locationId, schema.location.id), eq(schema.vehicle.tenantId, tenantId)),
    )
    .where(
      and(
        eq(schema.location.tenantId, tenantId),
        or(
          eq(schema.location.custodianEmployeeId, leaverId),
          and(isNull(schema.location.custodianEmployeeId), eq(schema.vehicle.foremanEmployeeId, leaverId)),
        ),
      ),
    )
    .orderBy(asc(schema.location.id));
}

/** Personal vehicles leave with the person; everything else moves. */
function splitOwnership(rows: DepartureContainer[], leaverName: string) {
  const containers: DepartureContainer[] = [];
  const skipped: SkippedContainer[] = [];
  for (const c of rows) {
    if (c.ownershipType === PERSONAL_VEHICLE) {
      skipped.push({
        ...c,
        reason: `${c.unit ?? c.locationName} is a personal vehicle (${c.ownershipType}). It is not Urban property, so it leaves with ${leaverName} and is never reassigned.`,
      });
    } else {
      containers.push(c);
    }
  }
  return { containers, skipped };
}

/*
  What the tool rides in AFTER the departure (STI-203 writer buckets).

  A departure asserts a new custodian, so the reflex is bucket one — both keys
  explicit, `?? null`, no fallback, because a new custody does not inherit the
  previous holder's rig. That reflex is wrong here, and the reason is physical:
  nobody unpacks the trailer. The tools stay in the same box, and the box is in
  this same move going to the same successor, so re-asserting "no truck" over
  every tool would erase a recorded ride from the fold — the partial-snapshot
  bug, key by key — for tools that never moved an inch.

  So the recorded keys are carried FORWARD verbatim, absent staying absent, as
  the container hand-over does — with ONE exception, which is the whole reason
  this function exists rather than a bare `vehicleContextFromLedger` call: a
  key naming a vehicle that is LEAVING WITH THE PERSON is written as an
  explicit null. That truck is the leaver's own property and drives off the
  site; a tool cannot still be riding in it, and "affirmatively none" is the
  honest answer rather than a stale uuid pointing at a vehicle Urban no longer
  has access to.
*/
export function rideAfterDeparture(
  recorded: { truckId?: string | null; trailerId?: string | null },
  leavingVehicleIds: Set<string>,
): { truckId?: string | null; trailerId?: string | null } {
  const out: { truckId?: string | null; trailerId?: string | null } = {};
  /* `in` and not a truthiness test: an ABSENT key folds to "not recorded" and
     an explicit null to "affirmatively none" — two different answers the fold
     keeps distinct (packages/domain/src/fold.ts). Absent must stay absent. */
  if ("truckId" in recorded) {
    out.truckId = recorded.truckId && leavingVehicleIds.has(recorded.truckId) ? null : (recorded.truckId ?? null);
  }
  if ("trailerId" in recorded) {
    out.trailerId =
      recorded.trailerId && leavingVehicleIds.has(recorded.trailerId) ? null : (recorded.trailerId ?? null);
  }
  return out;
}

/*
  Has this person actually left?

  The web form only offers terminated employees in the picker, and a filter in
  a `<select>` is not a rule — it is a convenience that anybody holding the
  permission bypasses with one API call. Without this check
  `departure.reassign` accepts an ACTIVE foreman's id and strips every tool he
  holds in one irreversible transaction, writing ledger events that name a
  departure which never happened. The ledger is append-only, so the correction
  is another forty events that also name it.

  `on_leave` is refused for the same reason as `active`, not by oversight:
  somebody on leave is coming back to the tools, and `dashboard.clearanceQueue`
  — the queue this action exists to drain — only ever lists `terminated`.
  The error names the status it actually found, because "he IS gone, I marked
  him last week" is the likeliest reason to hit this, and the fix is on the
  employee record rather than here.
*/
const DEPARTED = "terminated";

function assertHasLeft(leaver: { name: string; employmentStatus: string }): void {
  if (leaver.employmentStatus !== DEPARTED) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${leaver.name} is still on the books — their employment status is "${leaver.employmentStatus}", not "${DEPARTED}". Custody is only cleared for somebody who has actually left; mark them terminated first, or use a transfer.`,
    });
  }
}

async function loadLeaver(db: Database | Transaction, tenantId: string, leaverEmployeeId: string) {
  const leaver = await db.query.employee.findFirst({
    where: and(eq(schema.employee.id, leaverEmployeeId), eq(schema.employee.tenantId, tenantId)),
    columns: { id: true, name: true, employmentStatus: true, primaryProjectId: true },
  });
  if (!leaver) throw new TRPCError({ code: "NOT_FOUND", message: "No such person in this tenant." });
  return leaver;
}

/*
  What WOULD move, written nowhere.

  Read-only by construction: it takes either handle and calls no writer. A bulk
  custody move with no preview is how a mistake becomes forty ledger events,
  and the ledger cannot be edited afterwards — the correction is another forty
  events. The skipped list carries a per-vehicle reason for the same purpose:
  "why is his truck not in this list" must be answerable on the screen, not by
  reading this file.
*/
export async function previewDeparture(
  db: Database | Transaction,
  opts: { tenantId: string; leaverEmployeeId: string; successorEmployeeId?: string | null },
): Promise<DeparturePreview> {
  const { tenantId } = opts;
  const leaver = await loadLeaver(db, tenantId, opts.leaverEmployeeId);
  /* Refused here as well as in the mutation, so the screen learns it from the
     preview rather than from a failed confirm — and so the two surfaces cannot
     drift into disagreeing about who is clearable. */
  assertHasLeft(leaver);
  const successor = await resolveSuccessor(db, tenantId, leaver, opts.successorEmployeeId);

  const held = await toolsHeldBy(db, tenantId, leaver.id, false);
  const { containers, skipped } = splitOwnership(await containersHeldBy(db, tenantId, leaver.id), leaver.name);

  return {
    leaver: { id: leaver.id, name: leaver.name, employmentStatus: leaver.employmentStatus },
    successor,
    successorRequired: !successor,
    tools: held.map((a) => ({
      assetId: a.assetId,
      tag: a.tag,
      modelName: formatAssetModel(a),
      status: a.currentStatus,
      currentProjectId: a.currentProjectId,
    })),
    containers,
    skipped,
  };
}

export type DepartureResult = {
  leaver: { id: string; name: string };
  successor: Successor;
  tools: DepartureTool[];
  containers: DepartureContainer[];
  skipped: SkippedContainer[];
  /* Tools that moved because the BOX they sit in moved, not because they were
     on the leaver's name — an unheld drill in the trailer, or one held by
     somebody else. The preview cannot enumerate them (it lists what the leaver
     holds), so the count is reported back and the screen says so. */
  containerToolsMoved: number;
};

/*
  The move. One transaction, per invariant 3 — a departure that half-happened
  is worse than one that did not happen, because the queue then shows a
  shorter list and nobody knows which half is real.

  The sets are re-read inside the transaction rather than trusted from the
  preview: the preview is what a person was shown, and between reading it and
  clicking through, the desk may have returned a tool. What the transaction
  reads under its own locks is what it moves, and the result says what that
  turned out to be.
*/
export async function reassignOnDeparture(
  db: Database,
  opts: {
    tenantId: string;
    leaverEmployeeId: string;
    successorEmployeeId?: string | null;
    /* Not nullable, unlike the ledger's `actorId`: every caller of this is a
       signed-in operator, and the sanctioned container writer this delegates
       to requires one. A departure with nobody's name on it is not a thing we
       want to be able to write. */
    actorUserId: string;
    note?: string | null;
  },
): Promise<DepartureResult> {
  const { tenantId: tid } = opts;

  return db.transaction(async (tx) => {
    const leaver = await loadLeaver(tx, tid, opts.leaverEmployeeId);
    /* Re-checked inside the transaction, not trusted from the preview: the
       status could have been corrected between the two, and this is the call
       that writes. */
    assertHasLeft(leaver);
    const successor = await resolveSuccessor(tx, tid, leaver, opts.successorEmployeeId);
    if (!successor) {
      /* Never guess, and never leave the tools with the leaver. Both failure
         modes are silent; this one is loud and tells the caller what it needs. */
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Nobody active was found above ${leaver.name} in the reporting line. Choose who takes their tools.`,
      });
    }

    const held = await toolsHeldBy(tx, tid, leaver.id, true);
    const { containers, skipped } = splitOwnership(await containersHeldBy(tx, tid, leaver.id), leaver.name);

    /* The vehicles that drive away with the person. A tool cannot go on
       recording a ride in one of these — see rideAfterDeparture. */
    const leavingVehicleIds = new Set(skipped.map((c) => c.vehicleId).filter((id): id is string => !!id));
    /* And the location ROWS of those same vehicles. `rideAfterDeparture` nulls
       the truck key but the tool's `current_location_id` can point at the
       vehicle's own location row, which is the other half of the same fact —
       leaving it alone recorded "affirmatively no truck" and "sitting in P-306"
       on one snapshot, i.e. a tool parked inside a truck that is no longer
       Urban's and that nobody here can go and look in. */
    const leavingLocationIds = new Set(skipped.map((c) => c.locationId));

    /* Tools follow the person: they go to the successor's job, not to
       whichever project the leaver's row happened to name. Resolved once —
       every tool in this move is going to the same person — and falling back
       to the tool's own project when the successor has no primary job, so no
       snapshot below can blank a project the register still shows. */
    const successorProjectId = await projectForCustodian(tx, tid, successor.id, null);

    const note = opts.note?.trim() || `Departure: ${leaver.name} — custody to ${successor.name}`;

    for (const a of held) {
      const recorded = await vehicleContextFromLedger(tx, tid, a.assetId);
      const ride = rideAfterDeparture(recorded, leavingVehicleIds);
      const projectId = successorProjectId ?? a.currentProjectId;
      /*
        Where the tool is afterwards.

        Normally: exactly where it was. A departure changes WHO holds a tool,
        not where it is sitting, and re-stating the place is how you stamp a
        location the projection never updates — a `stale_projection`
        divergence on every moved tool, raised every six hours forever.

        The one exception is a tool recorded INSIDE a vehicle that is leaving
        with the person. That location row stays on the leaver (it is his
        truck), so the tool would keep naming a place Urban cannot open, on the
        very same snapshot where `rideAfterDeparture` has just written "no
        truck". Null — "we do not know where it is" — is the only honest
        answer: nobody watched him unload, and inventing the yard would be a
        claim about the physical world that this transaction cannot make. It
        reads as unknown on the tool page, which is exactly the prompt the desk
        needs to go and find it.

        Both halves are written below in this same transaction — the snapshot
        AND `current_location_id` on the row — so the fold and the register
        still agree and no divergence is raised.
      */
      const leftWithHim = !!a.currentLocationId && leavingLocationIds.has(a.currentLocationId);
      const locationId = leftWithHim ? null : a.currentLocationId;

      await moveCustody(tx, {
        tenantId: tid,
        assetId: a.assetId,
        toCustodianId: successor.id,
        projectId,
        locationId,
        truckId: ride.truckId,
        trailerId: ride.trailerId,
        actorUserId: opts.actorUserId,
      });

      await tx
        .update(schema.asset)
        .set({
          currentCustodianId: successor.id,
          currentProjectId: projectId,
          currentLocationId: locationId,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.asset.id, a.assetId), eq(schema.asset.tenantId, tid)));

      await tx.insert(schema.transaction).values({
        tenantId: tid,
        assetId: a.assetId,
        eventType: "custodian_change",
        actorId: opts.actorUserId,
        fromState: {
          status: a.currentStatus,
          custodianId: a.currentCustodianId,
          projectId: a.currentProjectId,
          locationId: a.currentLocationId,
        },
        toState: {
          /* Status carried, not stamped `assigned`. A departure moves the WHO
             and nothing else: a tool that was in the shop is still in the shop
             the morning after its holder left, and asserting `assigned` here
             would erase that — and disagree with the projection update above,
             which deliberately does not touch the status either. */
          status: a.currentStatus,
          custodianId: successor.id,
          projectId,
          locationId,
          ...ride,
        },
        refType: "employee",
        /* The departure itself is the audit trail this feature exists for:
           `employee` + the leaver's id is how every event from one departure is
           found again, and the note names it in words on the tool's timeline. */
        refId: leaver.id,
        note,
      });
    }

    /*
      The containers, through the ONE writer that hands a container over.

      This loop used to UPDATE `location.custodian_employee_id` and
      `vehicle.foreman_employee_id` itself. Those two statements looked
      harmless — they are not custody links, and the unique index does not
      police them — but they made this the second place in the codebase that
      knows what handing over a trailer means, and the two places disagreed:
      `applyContainerCustody` also moves what is INSIDE the box and reconciles
      the status of the contents, and this one did neither. So a leaver's
      trailer arrived on the successor's name with an unheld grinder still
      `available` inside it, while the identical hand-over done from the
      container screen assigned that grinder. Same event, two answers,
      depending on which button was pressed. That is the pattern CLAUDE.md
      calls the most expensive one this codebase has paid for, and it is why
      nothing below writes those columns directly any more.

      Contents are moved (`moveContents: true`) because that is what a
      container hand-over means everywhere else in the product; the tools that
      were on the leaver's OWN name have already moved in the loop above, so
      that writer's `currentCustodianId !== custodianId` filter skips them —
      which is also why this loop must stay AFTER that one. Were it before, the
      leaver's tools would be moved by the container writer instead, and it
      stamps `assigned` on what it moves: a tool that was in the shop would
      come out of a departure reading `assigned`.
    */
    let containerToolsMoved = 0;
    for (const c of containers) {
      containerToolsMoved += await applyContainerCustody({
        tx,
        tid,
        actorUserId: opts.actorUserId,
        locationId: c.locationId,
        locationName: c.locationName,
        custodianId: successor.id,
        custodianName: successor.name,
        moveContents: true,
        note,
      });
    }

    return {
      containerToolsMoved,
      leaver: { id: leaver.id, name: leaver.name },
      successor,
      tools: held.map((a) => ({
        assetId: a.assetId,
        tag: a.tag,
        modelName: formatAssetModel(a),
        status: a.currentStatus,
        currentProjectId: a.currentProjectId,
      })),
      containers,
      skipped,
    };
  });
}
