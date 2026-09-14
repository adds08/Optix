import { projectTeamsRouter } from "./routers/projectTeams.js";
import { router } from "./trpc.js";
import { identityRouter } from "./routers/identity.js";
import { dashboardRouter } from "./routers/dashboard.js";
import { smallToolRouter } from "./routers/smallTool.js";
import { categoryRouter } from "./routers/category.js";
import { projectRouter, employeeRouter } from "./routers/project.js";
import { projectTeamRouter } from "./routers/projectTeam.js";
import { departmentRouter } from "./routers/department.js";
import { locationRouter, equipmentRouter } from "./routers/equipment.js";
import { assignmentRouter } from "./routers/assignment.js";
import { transferRouter } from "./routers/transfer.js";
import { transactionRouter } from "./routers/transaction.js";
import { notificationRouter } from "./routers/notification.js";
import { reportRouter } from "./routers/report.js";
import { messagingRouter } from "./routers/messaging.js";
import { entityRouter } from "./routers/entity.js";
import { taskRouter } from "./routers/task.js";
import { inboxRouter } from "./routers/inbox.js";
import { actionRouter } from "./routers/action.js";
import { importRouter } from "./routers/import.js";
import { settingsRouter } from "./routers/settings.js";
import { projectGroupRouter } from "./routers/projectGroup.js";
import { preferencesRouter, THEME_NAMES, FONT_FAMILIES } from "./routers/preferences.js";
import { userRouter } from "./routers/user.js";
import { roleRouter } from "./routers/role.js";
import { departureRouter } from "./routers/custody-reassign.js";
import { featureRouter } from "./routers/feature.js";
import { onboardingRouter } from "./routers/onboarding.js";
import { syncRouter } from "./routers/sync.js";
export { ONBOARDING_STEPS, type OnboardingStep } from "./routers/onboarding.js";
export { llmConfigFor } from "./routers/settings.js";
export { mailConfigFor } from "./mail-config.js";

export const appRouter = router({
  identity: identityRouter,
  user: userRouter,
  role: roleRouter,
  departure: departureRouter,
  dashboard: dashboardRouter,
  /* `smallTool`, matching the table. `asset` was ambiguous — it could mean a
     truck or a building — and this register holds neither. */
  smallTool: smallToolRouter,
  category: categoryRouter,
  project: projectRouter,
  projectTeam: projectTeamRouter,
  projectTeams: projectTeamsRouter,
  department: departmentRouter,
  employee: employeeRouter,
  location: locationRouter,
  /*
    `equipment`, not `vehicle`. The table became `tbl_entity_equipment` in
    migration 0075 and the UI has said Equipment since 2026-08-27; this key was
    the last layer still saying vehicle.

    The PERMISSION strings are a different matter and deliberately unchanged —
    `asset.read`, `asset.manage` and the four `assets.view.*` scopes are ROWS in
    `tbl_entity_permission` granted to roles, so renaming them needs a grants
    migration, and this repo has already spent three tickets on permission
    changes reaching fresh databases and not live ones.
  */
  equipment: equipmentRouter,
  assignment: assignmentRouter,
  transfer: transferRouter,
  transaction: transactionRouter,
  notification: notificationRouter,
  report: reportRouter,
  messaging: messagingRouter,
  entity: entityRouter,
  task: taskRouter,
  inbox: inboxRouter,
  action: actionRouter,
  import: importRouter,
  settings: settingsRouter,
  preferences: preferencesRouter,
  projectGroup: projectGroupRouter,
  feature: featureRouter,
  onboarding: onboardingRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;

/* The local-only demo dataset's shared definition — CSV builders, the project
   merge contract, the roster split and the test tenant seeder. Exported from
   the package root because `apps/api/src/demo-data.ts` (a different package)
   is one of its two callers; the other is the demo test suite, which imports
   the same module by path. */
export * from "./demo-fixtures.js";
export {
  applyChatAction,
  requestChatAction,
  canApplyAction,
  permissionForAction,
  ACTION_PERMISSIONS,
  ACTION_DEPARTMENTS,
  departmentForAction,
  AUTO_SAFE_INTENTS,
  CUSTODY_INTENTS,
  type ChatAction,
  type AssetDraft,
  type ApplyOptions,
  type ApplyResult,
  type RequestResult,
} from "./apply-action.js";
export {
  router,
  publicProcedure,
  protectedProcedure,
  requirePermission,
  type Context,
} from "./trpc.js";
