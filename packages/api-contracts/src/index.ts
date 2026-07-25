import { router } from "./trpc.js";
import { identityRouter } from "./routers/identity.js";
import { dashboardRouter } from "./routers/dashboard.js";
import { assetRouter } from "./routers/asset.js";
import { projectRouter, employeeRouter } from "./routers/project.js";
import { locationRouter, vehicleRouter } from "./routers/location.js";
import { assignmentRouter } from "./routers/assignment.js";
import { transferRouter } from "./routers/transfer.js";
import { transactionRouter } from "./routers/transaction.js";
import { notificationRouter } from "./routers/notification.js";
import { reportRouter } from "./routers/report.js";
import { messagingRouter } from "./routers/messaging.js";
import { entityRouter } from "./routers/entity.js";
import { taskRouter } from "./routers/task.js";

export const appRouter = router({
  identity: identityRouter,
  dashboard: dashboardRouter,
  asset: assetRouter,
  project: projectRouter,
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
});

export type AppRouter = typeof appRouter;
export {
  applyChatAction,
  AUTO_SAFE_INTENTS,
  CUSTODY_INTENTS,
  type ChatAction,
} from "./apply-action.js";
export {
  router,
  publicProcedure,
  protectedProcedure,
  requirePermission,
  type Context,
} from "./trpc.js";
