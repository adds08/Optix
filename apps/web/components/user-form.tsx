"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityField } from "@/components/ui/entity-picker";

/*
  New login account — by invite, not by a password an admin hands over.

  There is no direct signup in this product: the only way an account becomes
  usable is by its owner consuming the link this form sends them. That is a
  deliberate narrowing from the old shape, where an admin typed or generated a
  password and read it out — the invite link proves the recipient controls the
  inbox before they ever see a credential, and `user.invite` creates the
  account `isActive: false` until they do.

  The form is otherwise about the ACCOUNT and nothing else. Somebody who holds
  tools is an `employee`, created on the People screen and perfectly able to
  exist with no account at all — the field below links an existing person, it
  does not create one, and leaving it blank is the normal case for office
  staff who sign in but never carry a grinder.
*/
/*
  The one moment a credential is readable, shown to the admin who asked for it.

  The server returns the plaintext exactly once and stores only the bcrypt
  hash, so there is no screen that can show it again — which is why this panel
  says so rather than letting somebody assume they can come back for it. It is
  exported because the reset dialog on the users screen shows the same thing
  and the two must not drift into saying different things about the same fact.

  When the admin typed the password themselves the server returns null, and
  there is nothing to reveal.
*/
export function CredentialNote({ email, password }: { email: string; password: string | null }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Hand these to <span className="font-medium">{email}</span> directly.
      </p>
      {password ? (
        <>
          <code className="block break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm">
            {password}
          </code>
          <p className="text-xs text-muted-foreground">
            Shown once. Only the hash is stored, so this cannot be displayed again — reset the
            password if it is lost. Because you now know it too, the account is flagged to change
            it: sign-in reports the flag, and it clears the moment they set their own.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          You set the password yourself, so there is nothing to reveal here.
        </p>
      )}
    </div>
  );
}

export function UserForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const roles = trpc.user.roles.useQuery();
  const employees = trpc.employee.list.useQuery();

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [error, setError] = useState("");
  /* Set once the invite is sent. Non-null means "we are on the second step" —
     there is no credential to show, only confirmation of where the link went
     and whether the email actually left the building. */
  const [sent, setSent] = useState<{ email: string; emailSent: boolean; emailError: string | null } | null>(null);

  /*
    `useMutation` rather than `utils.client.…mutate` inside a try/catch, because
    only the hook's `onError` gives a typed error. STI-204: `err.message` is
    machine text — a zod input failure carries the raw issue array there, and a
    short password used to put `[{"code":"too_small","minimum":10,…}]` on screen
    as if it were advice. `data.userMessage` is the formatter's contract: non-null
    exactly when the text was written for the person reading it, which is what
    makes the duplicate-email and cross-tenant refusals in `routers/user.ts`
    worth having been written in words.
  */
  const invite = trpc.user.invite.useMutation({
    onSuccess: (res) => {
      setError("");
      utils.user.list.invalidate();
      setSent({ email: res.user.email, emailSent: res.emailSent, emailError: res.emailError });
    },
    onError: (e) =>
      setError(e.data?.userMessage ?? "Could not create the invite. Try again, or ask another administrator."),
  });
  const submitting = invite.isPending;

  const submit = () => {
    if (!email || !firstName || !lastName) return;
    setError("");
    invite.mutate({
      email,
      firstName,
      lastName,
      roleId: roleId || undefined,
      employeeId: employeeId || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{sent ? "Invite sent" : "Invite a user"}</DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="space-y-3 text-sm">
            {sent.emailSent ? (
              <p>
                An invite was sent to <span className="font-medium">{sent.email}</span>. The account
                cannot sign in until they open it and choose a password — nothing to hand over here.
              </p>
            ) : (
              <div className="rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-warn">
                <p className="font-medium">The account was created, but the invite email failed to send.</p>
                <p className="mt-1">{sent.emailError ?? "No SMTP is configured on this server."}</p>
                <p className="mt-1">
                  Fix delivery in Settings → Notifications, then use Resend on this row.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">First name *</label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Last name *</label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email *</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                The invite goes here. Any address works, including personal ones — this system does
                not restrict sign-in to a company domain. It must be unique within Urban, and also
                unused by any other organisation on this system: sign-in does not yet ask which one
                you belong to, so a shared address locks both accounts out.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <EntityField
                value={roleId}
                onChange={setRoleId}
                placeholder="No role — can sign in, sees nothing"
                searchPlaceholder="Search roles…"
                emptyLabel="No role matches."
                options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Linked person</label>
              <EntityField
                value={employeeId}
                onChange={setEmployeeId}
                placeholder="Not linked — office account"
                searchPlaceholder="Name or employee number"
                emptyLabel="Nobody matches."
                options={(employees.data ?? []).map((e) => ({ value: e.id, label: e.name, hint: e.externalId ?? undefined }))}
              />
              <p className="text-xs text-muted-foreground">
                Optional, both ways. People hold tools; accounts sign in. A foreman on the People
                register needs no account, and this account needs no person.
              </p>
            </div>
            {error ? <p className="text-sm text-crit">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          {sent ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
              <Button onClick={submit} disabled={submitting || !email || !firstName || !lastName}>
                {submitting ? "Sending…" : "Send invite"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
