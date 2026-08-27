export { serverEnv } from "./server.js";
export type { ServerEnv } from "./server.js";
/*
  There was a `webEnv()` here, parsing NEXT_PUBLIC_* for the web app. Deleted
  2026-08-28: nothing ever imported it. `apps/web` reads `process.env.NEXT_PUBLIC_*`
  directly, which is what Next inlines at build time, so a Zod parse in a shared
  package could not have run in the browser anyway. Its last field went with the
  Optix rename the day before.
*/
