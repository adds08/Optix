"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
  Change your own password.

  This screen is the missing half of STI-303. That ticket shipped
  `must_change_password` — set when an administrator creates an account or
  resets a credential, cleared only by the account's owner — and `login()`
  reported it. Nothing read it. So every account created through
  `/admin/users` was told, in a column nobody rendered, that it had to change
  a password it had no way to change. The ticket recorded the gap under
  "Outstanding"; this closes it.

  `user.changePassword` is deliberately a bare `protectedProcedure` — one of
  the few writes with no permission, and the RBAC matrix test names the reason:
  gating it on an administrative permission would mean the people forced to
  change their password on first login are exactly the people who cannot.

  The server does the real checking: it verifies the current password, refuses
  a new one identical to it, enforces the minimum length, and revokes other
  sessions. Nothing here is a control — it is a form.
*/
export default function ChangePasswordPage() {
  const router = useRouter();
  const me = trpc.identity.me.useQuery();
  const utils = trpc.useUtils();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const change = trpc.user.changePassword.useMutation({
    onSuccess: async () => {
      setDone(true);
      setError(null);
      /* The flag lives on `identity.me`, and the shell redirects while it is
         set — so the cache has to be refreshed or the user bounces straight
         back here after changing it. */
      await utils.identity.me.invalidate();
      setTimeout(() => router.replace("/"), 1200);
    },
    /* `userMessage` is the STI-204 contract: non-null exactly when the text
       was written for the person reading it. Never render `message`. */
    onError: (e) => setError(e.data?.userMessage ?? "Could not change your password."),
  });

  const forced = me.data?.mustChangePassword === true;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("The two new passwords do not match.");
      return;
    }
    if (next.length < 10) {
      /* Mirrors the server's `min(10)` so the refusal arrives before the
         round-trip. The server still enforces it — this is courtesy. */
      setError("A new password needs at least 10 characters.");
      return;
    }
    change.mutate({ currentPassword: current, newPassword: next });
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-medium">Change your password</h1>
        </div>
        {forced ? (
          <p className="text-sm text-warn">
            Your password was set for you. Choose your own before carrying on.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Changing this signs you out of your other devices.
          </p>
        )}
      </div>

      {done ? (
        <p className="rounded-md border bg-card p-4 text-sm">
          Password changed. Taking you back…
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Current password</span>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">New password</span>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
            <span className="text-xs text-muted-foreground">At least 10 characters.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Confirm new password</span>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" disabled={change.isPending}>
            {change.isPending ? "Changing…" : "Change password"}
          </Button>
        </form>
      )}
    </div>
  );
}
