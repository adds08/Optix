import { router } from "./trpc.js";
import { identityRouter } from "./routers/identity.js";
import { dashboardRouter } from "./routers/dashboard.js";
import { assetRouter } from "./routers/asset.js";
import { categoryRouter } from "./routers/category.js";
import { projectRouter, employeeRouter } from "./routers/project.js";
import { projectTeamRouter } from "./routers/projectTeam.js";
import { departmentRouter } from "./routers/department.js";
import { locationRouter, vehicleRouter } from "./routers/location.js";
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
export { llmConfigFor } from "./routers/settings.js";

export const appRouter = router({
  identity: identityRouter,
  user: userRouter,
  role: roleRouter,
  departure: departureRouter,
  dashboard: dashboardRouter,
  asset: assetRouter,
  category: categoryRouter,
  project: projectRouter,
  projectTeam: projectTeamRouter,
  department: departmentRouter,
  employee: employeeRouter,
  location: locationRouter,
  vehicle: vehicleRouter,
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
});

export type AppRouter = typeof appRouter;
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
