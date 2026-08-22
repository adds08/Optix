"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
  New login account.

  The form is deliberately about the ACCOUNT and nothing else. Somebody who
  holds tools is an `employee`, created on the People screen and perfectly able
  to exist with no account at all — the field below links an existing person,
  it does not create one, and leaving it blank is the normal case for office
  staff who sign in but never carry a grinder.

  Leaving the password blank asks the server to generate one. It comes back
  exactly once, in the response, so the dialog switches to showing it rather
  than closing — closing on create would throw away the only copy.
*/
const SELECT_CLASS =
  "flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

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
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [error, setError] = useState("");
  /* Set once the account exists. Non-null means "we are on the second step" —
     the credential is on screen and the only Close is an acknowledgement. */
  const [issued, setIssued] = useState<{ email: string; password: string | null } | null>(null);

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
  const create = trpc.user.create.useMutation({
    onSuccess: (res) => {
      setError("");
      utils.user.list.invalidate();
      setIssued({ email: res.user.email, password: res.temporaryPassword });
    },
    onError: (e) =>
      setError(e.data?.userMessage ?? "Could not create the account. Try again, or ask another administrator."),
  });
  const submitting = create.isPending;

  const submit = () => {
    if (!email || !firstName || !lastName) return;
    setError("");
    create.mutate({
      email,
      firstName,
      lastName,
      password: password || undefined,
      roleId: roleId || undefined,
      employeeId: employeeId || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{issued ? "Account created" : "New user account"}</DialogTitle>
        </DialogHeader>

        {issued ? (
          <CredentialNote email={issued.email} password={issued.password} />
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
                This is the sign-in address, matched exactly — case included. It must be unique
                within Urban, and also unused by any other organisation on this system: sign-in
                does not yet ask which one you belong to, so a shared address locks both accounts
                out.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={SELECT_CLASS}>
                <option value="">No role — can sign in, sees nothing</option>
                {roles.data?.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Linked person</label>
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={SELECT_CLASS}>
                <option value="">Not linked — office account</option>
                {employees.data?.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Optional, both ways. People hold tools; accounts sign in. A foreman on the People
                register needs no account, and this account needs no person.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input
                type="password"
                value={password}
                placeholder="Leave blank to generate one"
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Shown once, on the next screen. Ten characters or more.
              </p>
            </div>
            {error ? <p className="text-sm text-crit">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          {issued ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
              <Button onClick={submit} disabled={submitting || !email || !firstName || !lastName}>
                {submitting ? "Creating…" : "Create account"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
