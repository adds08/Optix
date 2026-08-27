"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { forgotPassword } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptixLockup } from "@/components/optix-mark";
import { cn } from "@/lib/utils";
import { DUR, EASE } from "@/lib/motion";

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
    <main className="flex min-h-svh items-center justify-center px-6 py-12">
      <motion.div
        className="flex w-full max-w-[364px] flex-col gap-8"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.base, ease: EASE.out }}
      >
        <OptixLockup tagline />

        {/*
          The two states cross-fade in place rather than one replacing the
          other instantly. `mode="wait"` because they are alternatives, not a
          list — overlapping them would briefly show a form and a confirmation
          claiming different things about the same submission.
        */}
        <AnimatePresence mode="wait" initial={false}>
          {sent ? (
            <motion.div
              key="sent"
              className="flex flex-col gap-3"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: DUR.base, ease: EASE.out }}
            >
              <span
                aria-hidden
                className="flex size-10 items-center justify-center rounded-full bg-ok-bg text-ok"
              >
                <MailCheck className="size-5" />
              </span>
              <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
              <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                If <span className="font-medium text-foreground">{email}</span> has an account
                here, a reset link is on its way. It expires in an hour.
              </p>
              <BackToSignIn className="mt-1" />
            </motion.div>
          ) : (
            <motion.div
              key="form"
              className="flex flex-col gap-6"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: DUR.base, ease: EASE.out }}
            >
              <div className="flex flex-col gap-2">
                <h1 className="text-xl font-semibold tracking-tight">Forgot password</h1>
                <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
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
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={busy || !email}>
                  {busy ? "Sending…" : "Send reset link"}
                </Button>
                <BackToSignIn className="self-center" />
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </main>
  );
}

function BackToSignIn({ className }: { className?: string }) {
  return (
    <a
      href="/"
      className={cn(
        "group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      <ArrowLeft className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
      Back to sign in
    </a>
  );
}
