import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@stinventory/api-contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_URL = (process.env as Record<string, string>).EXPO_PUBLIC_API_URL ?? "http://localhost:4100";

const TOKEN_KEY = "stinventory_session";

export function setSession(token: string, userId: string, tenantId: string) {
  AsyncStorage.setItem(TOKEN_KEY, JSON.stringify({ token, userId, tenantId })).catch(() => {});
}

export async function clearSession() {
  try { await AsyncStorage.removeItem(TOKEN_KEY); } catch {}
}

async function loadStoredSession(): Promise<{ token: string | null }> {
  try {
    const raw = await AsyncStorage.getItem(TOKEN_KEY);
    if (raw) {
      const data = JSON.parse(raw) as { token: string; userId: string; tenantId: string };
      return { token: data.token };
    }
  } catch {}
  return { token: null };
}

export async function getStoredToken(): Promise<string | null> {
  const sess = await loadStoredSession();
  return sess.token;
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      transformer: superjson,
      async headers() {
        const sess = await loadStoredSession();
        return sess.token ? { Authorization: `Bearer ${sess.token}` } : {};
      },
    }),
  ],
});

export async function loginRequest(email: string, password: string) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? "Login failed");
  }
  const data = (await res.json()) as { sessionId: string; userId: string; tenantId: string };
  await setSession(data.sessionId, data.userId, data.tenantId);
  return data;
}

export async function logoutRequest() {
  const { token } = await loadStoredSession();
  if (token) {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
  }
  await clearSession();
}
