import { z } from "zod";
import { requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { previewDeparture, reassignOnDeparture } from "../departure.js";

/*
  The two procedures behind a departure (STI-306): see what would move, then
  move it. The reasoning — why personal vehicles never move, why the successor
  is never guessed, why it is one transaction — lives in ../departure.ts.

  PERMISSIONS. Both procedures are gated on `custody.reassign` (packages/types,
  granted in the seed to owner, equipment_admin and warehouse) — deliberately
  NOT on `assignment.approve`, which is what they were gated on first.
  Approving one proposed hand-off and stripping every tool a person holds in
  one irreversible transaction are different powers, and reusing the approve
  permission handed the second to everybody who had the first. The preview is
  gated the same way rather than on `assignment.read`: it is the roster of
  everything one named person is carrying, it exists only to be acted on, and a
  reader who cannot press the button has no reason to be shown it.
*/
export const departureRouter = router({
  preview: requirePermission("custody.reassign")
    .input(
      z.object({
        leaverEmployeeId: z.string().uuid(),
        /* Optional: absent means "work it out from the reporting line". The
           preview reports `successorRequired` rather than raising, because the
           screen has to be able to render the picker that answers it. */
        successorEmployeeId: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      previewDeparture(ctx.db, {
        tenantId: ctx.session.tenantId,
        leaverEmployeeId: input.leaverEmployeeId,
        successorEmployeeId: input.successorEmployeeId,
      }),
    ),

  reassign: requirePermission("custody.reassign")
    .input(
      z.object({
        leaverEmployeeId: z.string().uuid(),
        successorEmployeeId: z.string().uuid().optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await reassignOnDeparture(ctx.db, {
        tenantId: ctx.session.tenantId,
        leaverEmployeeId: input.leaverEmployeeId,
        successorEmployeeId: input.successorEmployeeId,
        actorUserId: ctx.session.userId,
        note: input.note,
      });

      /* Outside the transaction, like every other audit write here: a pool
         connection held across anything that can be slow is the wedge
         described in .claude/rules/custody-and-ledger.md, and the hand-over
         stands whether or not the log line lands. */
      await logEvent(ctx, {
        category: "assignment",
        action: "departure.reassign",
        entityType: "employee",
        entityId: result.leaver.id,
        entityLabel: result.leaver.name,
        details: {
          successorEmployeeId: result.successor.id,
          successorSource: result.successor.source,
          toolsMoved: result.tools.length,
          containersMoved: result.containers.length,
          /* Tools that moved because their box moved rather than because they
             were on the leaver's name — the half of this action the preview
             cannot enumerate, so the log is where it is answerable. */
          containerToolsMoved: result.containerToolsMoved,
          /* The skipped personal vehicles are logged BY UNIT, not counted: "we
             did not move his truck" is the half of this action somebody will
             later want proof of. */
          skippedVehicles: result.skipped.map((c) => c.unit ?? c.locationName),
        },
      });

      return result;
    }),
});
