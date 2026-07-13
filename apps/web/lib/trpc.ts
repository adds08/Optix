"use client";
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@stinventory/api-contracts";
import superjson from "superjson";
import { httpBatchLink } from "@trpc/client";

export const trpc = createTRPCReact<AppRouter>();

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
