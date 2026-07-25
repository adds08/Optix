import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getApiUrl } from "./trpc";
import { clearToken, getToken, setCachedToken, setToken } from "./session";

type AuthValue = {
  token: string | null;
  hydrating: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTok] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(true);

  /* Restore the stored session before anything renders, so a signed-in
     foreman never sees the login screen flash on cold start. */
  useEffect(() => {
    let alive = true;
    (async () => {
      const t = await getToken();
      if (!alive) return;
      setCachedToken(t);
      setTok(t);
      setHydrating(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${getApiUrl()}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error("invalid-credentials");
    const { sessionId } = (await res.json()) as { sessionId: string };
    await setToken(sessionId);
    setCachedToken(sessionId);
    setTok(sessionId);
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setCachedToken(null);
    setTok(null);
  }, []);

  const value = useMemo(
    () => ({ token, hydrating, signIn, signOut }),
    [token, hydrating, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
