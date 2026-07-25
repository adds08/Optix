import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type { AppRouter } from "@stinventory/api-contracts";
import { cachedToken } from "./session";

export const trpc = createTRPCReact<AppRouter>();

/*
  A phone on a jobsite cannot reach "localhost" — that resolves to the device
  itself. In development we derive the dev machine's LAN address from the Expo
  host, so a real handset on the same wifi hits the right API without anyone
  editing a config file.
*/
export function getApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit;

  if (Platform.OS === "web") return "http://localhost:4100";

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  const host = hostUri?.split(":")[0];
  return host ? `http://${host}:4100` : "http://localhost:4100";
}

export function createClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getApiUrl()}/trpc`,
        transformer: superjson,
        headers() {
          const token = cachedToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
