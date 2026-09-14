"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Loader2 } from "lucide-react";
import { login, getSession, setSession } from "@/lib/auth";
import { LAND_ON_PIN } from "@/components/sti/nav-pins";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthFrame } from "@/components/auth-frame";
import { DUR, EASE } from "@/lib/motion";


/*
  One rise, staggered by position down the column.

  A helper rather than `motion`'s variants API because there are four of them
  on one page and a variants tree is more machinery than four numbers. Nothing
  here delays interaction: the fields are in the DOM and focusable from the
  first frame, and only their opacity and offset are animated.
*/
function rise(i: number) {
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DUR.base, ease: EASE.out, delay: 0.05 + i * 0.06 },
  };
}

/*
  Arm the one-shot pin landing.

  Both routes into the app go through `/` and then to `/home`, and the shell
  cannot tell an arriving session from an ordinary visit to the dashboard — so
  the marker is set here, where "somebody is opening the app" is knowable, and
  consumed once in `app-shell.tsx` after permissions land.

  `sessionStorage`, not `localStorage`: it must not outlive the tab, or a reload
  next week would redirect somebody who had deliberately navigated to /home.
*/
function armPinLanding() {
  try {
    sessionStorage.setItem(LAND_ON_PIN, "1");
  } catch {
    /* Storage disabled: the session lands on /home, which is fine. */
  }
}

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getSession()) {
      /* Returning with a session already in hand is just as much "opening the
         app" as signing in, so it arms the pin landing too. Without this, only
         a fresh sign-in reached the first pinned row and every subsequent visit
         went to /home — which is not what "the default navigation" means. */
      armPinLanding();
      router.replace("/home");
    }
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
      armPinLanding();
      router.replace("/home");
    } catch {
      setError("That email and password combination did not work. Check both and try again.");
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <div className="flex flex-col gap-9">
        <motion.div className="flex flex-col gap-2" {...rise(0)}>
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">
            Sign in
          </h1>
          {/* Names the OPERATION, not one resource. "Tool and equipment
              custody" described the register this product grew out of and
              undersold everything the panel beside it claims. */}
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Run the job from one record — the crews, the plant and the tools on it, and
            every move between them.
          </p>
        </motion.div>

        <motion.form onSubmit={submit} className="flex flex-col gap-4" {...rise(1)}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium">Password</label>
              <a href="/forgot-password" className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground">
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

          {/* Height-animated so the button does not jump down the page the
              instant a wrong password comes back — the one moment on this
              screen where the layout moving is actively unhelpful. */}
          <AnimatePresence initial={false}>
            {error ? (
              <motion.p
                key="error"
                role="alert"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: DUR.base, ease: EASE.out }}
                className="overflow-hidden rounded-md border border-crit/30 bg-crit-bg px-3 py-2 text-sm text-crit"
              >
                {error}
              </motion.p>
            ) : null}
          </AnimatePresence>

          <Button type="submit" disabled={busy} className="group mt-1">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? "Signing in…" : "Sign in"}
            {busy ? null : (
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            )}
          </Button>
        </motion.form>
      </div>
    </AuthFrame>
  );
}
