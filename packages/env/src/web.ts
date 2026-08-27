import { z } from "zod";

/*
  `NEXT_PUBLIC_APP_NAME` was removed with the Optix rename (2026-08-27). It was
  declared here, in both compose files, in `.env.example` and in
  `docker/Dockerfile.web`, and read by nothing — the browser tab's title is a
  literal in `apps/web/app/layout.tsx` and the mark is `optix-mark.tsx`. Five
  copies of a product name that no screen consults is five places to leave
  saying "STInventory" after a rename, which is exactly what happened.

  Don't reintroduce it as white-labelling. A NEXT_PUBLIC_* is inlined into the
  bundle at build time, so it is one name per IMAGE — it cannot vary per tenant,
  which is the only way a product sold to more than one customer would need it.
  That belongs in `tenant_settings`, read at runtime.
*/
const webSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:4100"),
});

export type WebEnv = z.infer<typeof webSchema>;

export function webEnv(): WebEnv {
  return webSchema.parse({
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  });
}
