const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

export function login(email: string, password: string) {
  return fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error("Login failed"))));
}

export function logout() {
  const token = localStorage.getItem("sti-session");
  return fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getSession() {
  return localStorage.getItem("sti-session");
}
export function setSession(token: string) {
  localStorage.setItem("sti-session", token);
}
export function clearSession() {
  localStorage.removeItem("sti-session");
}

/*
  Self-service password recovery and invite acceptance.

  Hit `apps/api`'s auth endpoints directly, the same way `login` above does,
  rather than through tRPC — these are unauthenticated by necessity, and the
  API puts them next to `/auth/login` for exactly that reason (see the header
  comment there).
*/

/* Always resolves — even for an address that does not exist. The server
   answers identically either way (STI-305's enumeration reasoning applied to
   password recovery), so there is nothing for the client to branch on. */
export function forgotPassword(email: string): Promise<{ ok: true }> {
  return fetch(`${API_BASE}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  }).then((r) => r.json());
}

export type AuthTokenInfo =
  | { ok: true; kind: "invite" | "reset"; firstName: string; email: string; tenantName: string }
  | { ok: false; error: string };

/* Safe to expose unauthenticated: a valid token is 256 random bits nobody
   could have guessed, so knowing one already proves the caller received the
   email it was sent in — see the comment on the endpoint itself. */
export function getAuthToken(token: string): Promise<AuthTokenInfo> {
  return fetch(`${API_BASE}/auth/tokens/${encodeURIComponent(token)}`).then((r) => r.json());
}

/* Spends the token and signs the caller in — the response is the same shape
   `login` returns, so callers can `setSession` and redirect straight in. */
export function consumeAuthToken(
  token: string,
  password: string,
): Promise<{ sessionId: string; userId: string; tenantId: string }> {
  return fetch(`${API_BASE}/auth/tokens/${encodeURIComponent(token)}/consume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body?.error ?? "That link could not be used.");
    return body;
  });
}
