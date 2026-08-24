"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { consumeAuthToken, getAuthToken, setSession, type AuthTokenInfo } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
  Shared shell for the two pages a token link opens: `/invite/[token]` and
  `/reset/[token]`. Both are "look the token up, then ask for a password" —
  what differs is a handful of words, not the mechanics, so one component
  takes an `expectedKind` and a `copy` block rather than two near-duplicate
  pages drifting apart on the parts that are NOT copy (loading states, the
  password-mismatch check, what happens on success).

  Unauthenticated by construction — there is no session yet when either page
  loads, which is the whole reason `apps/api` exposes these as plain Hono
  routes next to `/auth/login` rather than as tRPC procedures.
*/
export function AuthTokenForm({
  token,
  expectedKind,
  copy,
}: {
  token: string;
  expectedKind: "invite" | "reset";
  copy: {
    heading: (info: Extract<AuthTokenInfo, { ok: true }>) => string;
    subheading: (info: Extract<AuthTokenInfo, { ok: true }>) => string;
    submitLabel: string;
    submittingLabel: string;
    successLabel: string;
    wrongKindMessage: string;
    invalidHeading: string;
    invalidHint: string;
  };
}) {
  const router = useRouter();
  const [info, setInfo] = useState<AuthTokenInfo | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getAuthToken(token).then(setInfo).catch(() => setInfo({ ok: false, error: "invalid_or_expired" }));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) {
      setError("Password must be at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await consumeAuthToken(token, password);
      setSession(res.sessionId);
      setDone(true);
      router.replace("/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That link could not be used.");
      setBusy(false);
    }
  }

  if (info === null) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (!info.ok || info.kind !== expectedKind) {
    return (
      <div className="flex min-h-svh items-center justify-center px-6">
        <div className="flex w-full max-w-[380px] flex-col gap-3 rounded-md border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">{copy.invalidHeading}</h1>
          <p className="text-sm text-muted-foreground">
            {info.ok ? copy.wrongKindMessage : copy.invalidHint}
          </p>
          <a href="/" className="mt-2 text-sm underline underline-offset-4">
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center px-6">
      <div className="flex w-full max-w-[380px] flex-col gap-6 rounded-md border bg-card p-6">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-sm bg-primary text-xs font-bold text-primary-foreground">
            ST
          </span>
          <span className="font-semibold tracking-tight">STInventory</span>
        </div>

        {done ? (
          <p className="flex items-center gap-2 text-sm text-ok">
            <CheckCircle2 className="size-4" aria-hidden />
            {copy.successLabel}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold tracking-tight">{copy.heading(info)}</h1>
              <p className="text-sm text-muted-foreground">{copy.subheading(info)}</p>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-sm font-medium">New password</label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">Ten characters or more.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm" className="text-sm font-medium">Confirm password</label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>

              {error ? (
                <p role="alert" className="rounded-md border border-crit/30 bg-crit-bg px-3 py-2 text-sm text-crit">
                  {error}
                </p>
              ) : null}

              <Button type="submit" disabled={busy}>
                {busy ? copy.submittingLabel : copy.submitLabel}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
