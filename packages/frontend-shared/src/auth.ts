import { useState, useEffect, useCallback } from "react";
import type { AuthState } from "./types";
import { api } from "./api-client";

const STORAGE_KEY = "sti-session";

function getStoredSession(): string | null {
  if (typeof window !== "undefined") return localStorage.getItem(STORAGE_KEY);
  return null;
}

function setStoredSession(token: string | null) {
  if (typeof window !== "undefined") {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  }
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ isAuthenticated: false, permissions: [] });
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    const token = getStoredSession();
    if (!token) { setLoading(false); return; }
    try {
      const user = await api.me();
      setState({ isAuthenticated: true, userName: `${user.firstName} ${user.lastName}`, role: user.role, permissions: user.permissions ?? [] });
    } catch { setStoredSession(null); }
    setLoading(false);
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    setStoredSession(res.sessionId);
    await loadSession();
  }, [loadSession]);

  const logout = useCallback(async () => {
    setStoredSession(null);
    setState({ isAuthenticated: false, permissions: [] });
  }, []);

  const hasPermission = useCallback((perm: string) => state.permissions.includes(perm), [state.permissions]);

  return { ...state, loading, login, logout, hasPermission };
}
