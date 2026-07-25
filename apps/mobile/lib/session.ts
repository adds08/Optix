import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/*
  Session token storage.

  SecureStore is the right home for an auth token on a device a foreman may
  lose on a jobsite — but it is NOT supported on web, and this app also runs
  under `expo start --web`. So the adapter falls back to localStorage there.
  Everything above this file just calls get/set/clear.
*/

const KEY = "sti-session";
const isWeb = Platform.OS === "web";

export async function getToken(): Promise<string | null> {
  try {
    if (isWeb) {
      return typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    }
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  if (isWeb) {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, token);
    return;
  }
  await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken(): Promise<void> {
  if (isWeb) {
    if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}

/*
  Read synchronously for the tRPC header callback, which cannot await.
  Kept in memory and refreshed whenever the token changes.
*/
let cached: string | null = null;
export function cachedToken(): string | null {
  return cached;
}
export function setCachedToken(t: string | null): void {
  cached = t;
}
