"use client";

import { useState } from "react";
import { forgotPassword } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
  Deliberately says the same thing whether or not the address has an account
  — `apps/api`'s `/auth/forgot-password` always answers `{ ok: true }`, and
  this page mirrors that rather than trying to be smarter than the endpoint
  it calls. See the STI-305 enumeration reasoning on that route.
*/
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await forgotPassword(email).catch(() => null);
    setBusy(false);
    setSent(true);
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-6">
      <div className="flex w-full max-w-[380px] flex-col gap-6">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-sm bg-primary text-xs font-bold text-primary-foreground">
            ST
          </span>
          <span className="font-semibold tracking-tight">STInventory</span>
        </div>

        {sent ? (
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              If <span className="font-medium">{email}</span> has an account here, a reset link is on
              its way. It expires in an hour.
            </p>
            <a href="/" className="mt-2 text-sm underline underline-offset-4">Back to sign in</a>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Forgot password</h1>
              <p className="text-sm text-muted-foreground">
                Enter your sign-in address and we&rsquo;ll send a link to reset it.
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
              <Button type="submit" disabled={busy || !email}>
                {busy ? "Sending…" : "Send reset link"}
              </Button>
              <a href="/" className="text-center text-sm underline underline-offset-4">Back to sign in</a>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
