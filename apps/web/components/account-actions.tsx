"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
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
      await utils.client.user.invite.mutate({
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
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That invitation could not be sent.");
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
