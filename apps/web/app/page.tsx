"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { login, getSession, setSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthPanel } from "@/components/auth-panel";

/*
  The demo affordances are opt-in, and off unless a build says otherwise.

  This page used to pre-fill a working account and print the shared password
  underneath the form. That is exactly right on a laptop and indefensible on a
  public host: it advertises every valid address and their shared password to anyone
  who loads the page, and it breaks the moment those accounts are disabled —
  which is the first thing a real deployment does.

  Local development sets NEXT_PUBLIC_SHOW_DEMO_LOGINS=1 and loses nothing.
*/
const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === "1";

/*
  One entry per role since STI-304. It was three — all of which see everything —
  which is why every journey this product was ever demonstrated on was driven by
  an account that could not be refused anything.

  Ordered widest-visibility first, so the three that differ from each other are
  adjacent: signing in as `pm` and then `super` is the fastest way to see the
  visibility ladder actually do something.
*/
const DEMO = [
  { email: "owner@stinventory.local", who: "System Administrator — everything" },
  { email: "admin@stinventory.local", who: "Karen Osei — Equipment Administrator" },
  { email: "office@stinventory.local", who: "Lena Boyd — Office Admin, no custody" },
  { email: "warehouse@stinventory.local", who: "Yard Desk — Warehouse" },
  { email: "pm@stinventory.local", who: "Dana Whitmore — PM, Lone Star only" },
  { email: "engineer@stinventory.local", who: "Priya Raman — Engineer, DART only" },
  { email: "super@stinventory.local", who: "Marcus Whitfield — Super, his crew" },
  { email: "foreman@stinventory.local", who: "Alejandro Capuchino — his own tools" },
  { email: "mechanic@stinventory.local", who: "Ruben Ortiz — Mechanic, the shop" },
  { email: "hr@stinventory.local", who: "Tomas Reyes — HR, people not tools" },
  { email: "finance@stinventory.local", who: "Grace Lin — Finance" },
  { email: "procurement@stinventory.local", who: "Nadia Kerr — Procurement" },
  { email: "readonly@stinventory.local", who: "Read-only" },
];

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(SHOW_DEMO ? "admin@stinventory.local" : "");
  const [password, setPassword] = useState(SHOW_DEMO ? "stinventory-demo" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getSession()) router.replace("/home");
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(email, password);
      setSession(res.sessionId);
      /*
        A new session must not inherit the previous one's query cache.

        `Providers` builds the QueryClient in the ROOT layout, so it outlives
        the `/` → `/home` navigation and keeps every cached result — including
        a cached ERROR. That made sign-in self-defeating: once `identity.me`
        had failed, its error stayed in the cache, so on the next sign-in
        `AppShell` remounted, read `isError: true` straight from cache before
        any request went out, and ran the `clearSession()` in its error effect
        — deleting the token this line had just stored. The tRPC batch then
        dispatched with no Authorization header at all and came back 401 in
        26µs, which bounced the user back here to do it all again. Twelve
        rounds of that on production 2026-08-24 14:47, and it only broke when
        the tab was hard-reloaded into a fresh cache.

        Clearing here also stops one person's cached rows being served to the
        next person to sign in on the same browser.
      */
      queryClient.clear();
      router.replace("/home");
    } catch {
      setError("That email and password combination did not work. Check both and try again.");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      {/* The yard, animated — left (docs/20, E). The form is the task; this
          panel is the reason to bother, and it must never slow the form. */}
      <aside className="relative hidden overflow-hidden border-r bg-muted/30 lg:block">
        <AuthPanel />
      </aside>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-[380px] flex-col gap-8">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-sm bg-primary text-xs font-bold text-primary-foreground">
              ST
            </span>
            <span className="font-semibold tracking-tight">STInventory</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="text-sm text-muted-foreground">
              Small tools and equipment custody for Urban Infraconstruction.
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium">Email</label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium">Password</label>
                <a href="/forgot-password" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  Forgot password?
                </a>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error ? (
              <p role="alert" className="rounded-md border border-crit/30 bg-crit-bg px-3 py-2 text-sm text-crit">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={busy} className="mt-1">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          {SHOW_DEMO ? (
            <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
              <span className="label-xs">Demo accounts · password stinventory-demo</span>
              <div className="flex flex-col gap-1">
                {DEMO.map((d) => (
                  <button
                    key={d.email}
                    type="button"
                    onClick={() => { setEmail(d.email); setPassword("stinventory-demo"); }}
                    className="rounded-sm px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="font-mono">{d.email}</span>
                    <span className="block text-[0.7rem] opacity-80">{d.who}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
