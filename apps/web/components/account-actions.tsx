"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote } from "@/components/sti/page";

/*
  A person's LOGIN, administered from the person.

  This is what `/admin/users` used to be. It was a second register of the same
  people, which is what made "why is there a People page and a User Accounts
  page" a fair question: an account is a property of a person, not a separate
  subject, and keeping them apart meant two screens, two searches and two places
  a name could be wrong.

  Inviting is the primary path and creating a password directly is not offered
  here. An invite proves the address on the way in — the token only ever exists
  in that mailbox, so following it is the email verification — whereas a
  generated password has to be read out to somebody over a phone and leaves an
  account whose credential two people know. `user.create` still exists for the
  cases that need it; it is simply not the button.
*/

type Person = {
  id: string;
  name: string;
  email?: string | null;
  roleId?: string | null;
  userId?: string | null;
};

/* "Dwayne Miller" -> first "Dwayne", last "Miller". A single-word name gets the
   whole thing as the first name and a dash for the last, because `user.invite`
   requires both and refusing to invite somebody whose record holds one word
   would be a worse answer than a placeholder somebody can edit. */
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] ?? "—", lastName: "—" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1]! };
}

export function InviteDialog({ person, open, onClose }: { person: Person; open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const seed = splitName(person.name);
  const [email, setEmail] = useState(person.email ?? "");
  const [firstName, setFirstName] = useState(seed.firstName);
  const [lastName, setLastName] = useState(seed.lastName);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      const result = await utils.client.user.invite.mutate({
        email: email.trim(),
        firstName,
        lastName,
        /* The person's role, not a second choice. The whole point of the role
           living on the PERSON is that the account inherits it — offering a
           different one here would recreate the two-role split this replaced. */
        roleId: person.roleId ?? undefined,
        employeeId: person.id,
      });
      utils.employee.list.invalidate();
      /*
        The ONE action in this app whose effect the sender cannot verify: the
        mail goes to somebody else's inbox, and the only visible trace here is
        one cell flipping to "Invited" on a twenty-five row table. Naming the
        address back is the point — a typo in it is otherwise indistinguishable
        from a delivery that simply has not happened yet.
      */
      if (!result.emailSent) {
        toast.error("Account created, but email was not sent", { description: result.emailError ?? "Use Resend invitation to retry." });
        onClose();
        return;
      }
      toast.success("Invitation sent", { description: email.trim() });
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : "That invitation could not be sent.";
      /* Kept inline AS WELL as toasted, deliberately: the dialog stays open on
         failure so the address is still there to correct, and the reason has to
         be readable next to the field that caused it. The toast is for somebody
         who has already looked away. */
      toast.error("Invitation not sent", { description: message });
      setError(message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite {person.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {/* Said plainly, because most of a yard does not have a company
                address and inviting to the wrong one is silent until somebody
                asks why they never got it. */}
            <p className="text-xs text-muted-foreground">
              Where the invitation goes. Often a personal address — most of the crew have no company mailbox.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">First name</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Last name</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          {error ? <ErrorNote message={error} /> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={sending || !email.trim()}>
            {sending ? "Sending…" : "Send invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/*
  The credential `user.resetPassword` mints, shown once.

  This exists because the procedure RETURNS a temporary password and the
  people register used to throw it away — see the long comment on the
  `resetPassword` mutation in `app/(app)/people/page.tsx` for what that
  combination did to a real account. Nothing is emailed by that procedure and
  nothing ever was; the administrator who pressed the button is the only route
  this credential has to the person who now needs it.

  SHOWN ONCE, and the copy says so plainly rather than implying it can be
  found again later. It genuinely cannot: only the bcrypt hash is stored, so
  closing this dialog without passing it on means resetting again.

  No toast on success for this action, deliberately — a toast auto-dismisses,
  and a credential that vanishes after four seconds is the same defect in a
  smaller font.
*/
export function TemporaryPasswordDialog({
  name,
  password,
  onClose,
}: {
  name: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      /* Clipboard access is refused in some contexts (an insecure origin, a
         browser policy). The password is selectable on screen regardless, so
         this is a convenience failing, not the feature failing. */
      setCopied(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporary password for {name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-400">
            This is shown once and is not emailed to them. Copy it now and pass it on — if you
            close this without doing so, you will have to reset again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm select-all">
              {password}
            </code>
            <Button variant="outline" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {name} will be asked to choose a new password when they next sign in. Every existing
            session of theirs has been signed out.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
