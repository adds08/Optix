"use client";
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@stinventory/api-contracts";
import superjson from "superjson";
import { httpBatchLink, type TRPCClientErrorLike } from "@trpc/client";

export const trpc = createTRPCReact<AppRouter>();

/*
  The retry policy for every query in the app.

  `retry: false` was the habit here, and it is wrong in the same way everywhere
  it appears: it treats "the session is gone" and "one request lost the
  network" as the same event, and gives up permanently on both. On a phone in a
  yard the second is routine.

  An `UNAUTHORIZED` is the only failure retrying cannot mend — the credential is
  dead, and hammering it just delays the redirect. Everything else gets two more
  chances before anyone is told anything.

  Sign-out is NOT this function's job. `AppShell` owns that, in one place, off
  the same error code — see `.claude/rules/web.md`.
*/
export function retryUnlessUnauthorized(
  failureCount: number,
  error: TRPCClientErrorLike<AppRouter>,
): boolean {
  return error.data?.code !== "UNAUTHORIZED" && failureCount < 2;
}

export function getApiUrl() {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";
}

export function trpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getApiUrl()}/trpc`,
        transformer: superjson,
        headers() {
          const token = typeof window !== "undefined" ? localStorage.getItem("sti-session") : null;
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
