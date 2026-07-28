"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { login, getSession, setSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
  The demo affordances are opt-in, and off unless a build says otherwise.

  This page used to pre-fill a working account and print the shared password
  underneath the form. That is exactly right on a laptop and indefensible on a
  public host: it advertises four valid addresses and their password to anyone
  who loads the page, and it breaks the moment those accounts are disabled —
  which is the first thing a real deployment does.

  Local development sets NEXT_PUBLIC_SHOW_DEMO_LOGINS=1 and loses nothing.
*/
const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === "1";

const DEMO = [
  { email: "owner@stinventory.local", who: "Owner — full access" },
  { email: "admin@stinventory.local", who: "Karen Osei — Equipment Admin" },
  { email: "warehouse@stinventory.local", who: "Yard Desk — Warehouse" },
  { email: "foreman.miguel@stinventory.local", who: "Miguel Torres — Foreman (field layout)" },
];

export default function LoginPage() {
  const router = useRouter();
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
      router.replace("/home");
    } catch {
      setError("That email and password combination did not work. Check both and try again.");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-svh lg:grid-cols-2">
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
              <label htmlFor="password" className="text-sm font-medium">Password</label>
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

      {/* The product thesis, not decoration. */}
      <aside className="relative hidden overflow-hidden border-l bg-muted/30 lg:block">
        <div
          aria-hidden
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative flex h-full flex-col justify-center gap-8 px-14">
          <p className="max-w-[24ch] text-3xl font-semibold leading-[1.15] tracking-tight text-balance">
            Every hand-off is a transaction, not a memory.
          </p>
          <div className="flex flex-col gap-3">
            {[
              ["03 MAR", "Received from Hilti, tagged UIC-1012"],
              ["11 MAR", "Assigned to M. Torres — Legacy West"],
              ["02 JUN", "Transferred to D. Ellis — Trinity Bridge"],
            ].map(([when, what]) => (
              <div key={when} className="flex items-baseline gap-3 rounded-md border bg-card px-3 py-2">
                <span className="label-xs shrink-0">{when}</span>
                <span className="text-sm">{what}</span>
              </div>
            ))}
          </div>
          <p className="max-w-[44ch] text-sm text-muted-foreground text-pretty">
            Where a tool is, who holds it, and which project paid for it are derived from that
            log — never typed into a field somebody can overwrite.
          </p>
        </div>
      </aside>
    </main>
  );
}
