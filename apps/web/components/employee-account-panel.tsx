"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ErrorNote } from "@/components/sti/page";
import { InviteDialog, TemporaryPasswordDialog } from "@/components/account-actions";
import { toast } from "sonner";

export function EmployeeAccountPanel({ person }: { person: { id: string; name: string; email?: string | null; roleId?: string | null } }) {
  const { has } = usePermissions();
  const utils = trpc.useUtils();
  const query = trpc.user.accountForEmployee.useQuery({ employeeId: person.id }, { enabled: has("user.manage") });
  const [invite, setInvite] = useState(false);
  const [action, setAction] = useState<"password" | "complete" | "reopen" | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState("");
  const refresh = async () => { await Promise.all([query.refetch(), utils.employee.list.invalidate(), utils.onboarding.state.invalidate()]); };
  const reset = trpc.user.resetPassword.useMutation({ onError: e => setError(e.message) });
  const setup = trpc.onboarding.administer.useMutation({ onError: e => setError(e.message) });
  const mail = trpc.user.sendResetEmail.useMutation({ onSuccess: async r => { if (r.emailSent) toast.success("Password link sent"); else toast.error("Email was not sent", { description: r.emailError ?? "Try again." }); await refresh(); }, onError: e => toast.error(e.message) });
  const resend = trpc.user.resendInvite.useMutation({ onSuccess: async r => { if (r.emailSent) toast.success("Invitation sent"); else toast.error("Email was not sent", { description: r.emailError ?? "Try again." }); await refresh(); }, onError: e => toast.error(e.message) });
  if (!has("user.manage")) return null;
  const account = query.data?.account;
  const onboarding = query.data?.onboarding;
  const submit = async () => {
    if (!account || !action) return;
    setError("");
    try {
      if (action === "password") {
        const result = await reset.mutateAsync({ userId: account.id, password: password || undefined });
        setIssued(result.temporaryPassword ?? password);
        setPassword("");
      } else {
        await setup.mutateAsync({ userId: account.id, action, reason });
        toast.success(action === "complete" ? "Setup marked done" : "Setup reopened. Project claiming remains closed.");
      }
      setAction(null); await refresh();
    } catch { /* Mutation callbacks keep the actionable error in the open dialog. */ }
  };
  return <section className="space-y-4 rounded-lg border bg-card p-4">
    <h2 className="font-semibold">Account & setup</h2>
    {query.error && <ErrorNote message={query.error.message} />}
    {query.isLoading ? <p>Loading account…</p> : <>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Created through</dt><dd>{query.data?.creationSource ?? "Unknown"}</dd></div>
        <div><dt className="text-muted-foreground">Sign-in</dt><dd>{account ? account.isActive ? account.emailVerifiedAt ? "Active" : "Active · email not verified" : account.emailVerifiedAt ? "Deactivated" : "Invitation not accepted" : "No account"}</dd></div>
        {account && <><div><dt className="text-muted-foreground">Email</dt><dd className="break-all">{account.email}</dd></div><div><dt className="text-muted-foreground">Onboarding</dt><dd>{onboarding?.completedAt && !onboarding.dismissedAt ? "Completed" : onboarding ? "In progress" : "Not started"}</dd></div><div><dt className="text-muted-foreground">Last sign-in</dt><dd>{account.lastSignInAt ? new Date(account.lastSignInAt).toLocaleString() : "Never"}</dd></div></>}
      </dl>
      {query.data?.sources.map(source => <p key={source.system} className="rounded-md bg-muted p-3 text-sm">Connected to <strong>{source.system}</strong> · Employee ID {source.externalId}<br /><span className="text-muted-foreground">Last synced: {source.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleString() : "Not recorded"}. Imported HR details are maintained in BambooHR.</span></p>)}
      <div className="flex flex-wrap gap-2">
        {!account ? <Button onClick={() => setInvite(true)}>Invite to Optix</Button> : <>
          {!account.isActive && !account.emailVerifiedAt && <Button variant="outline" disabled={resend.isPending} onClick={() => resend.mutate({ userId: account.id })}>Resend invitation</Button>}
          <Button variant="outline" disabled={mail.isPending} onClick={() => mail.mutate({ userId: account.id })}>Send password link</Button>
          <Button variant="outline" onClick={() => { setError(""); setAction("password"); }}>Set temporary password</Button>
          <Button variant="outline" onClick={() => { setError(""); setAction("complete"); }}>Mark setup done</Button>
          <Button variant="outline" onClick={() => { setError(""); setAction("reopen"); }}>Re-onboard</Button>
        </>}
      </div>
    </>}
    {invite && <InviteDialog person={person} open onClose={() => { setInvite(false); void refresh(); }} />}
    <Dialog open={!!action} onOpenChange={open => { if (!open) { setAction(null); setPassword(""); } }}><DialogContent><DialogHeader><DialogTitle>{action === "password" ? "Set a temporary password" : action === "complete" ? "Mark setup done" : "Re-onboard"}</DialogTitle></DialogHeader>
      {action === "password" ? <label className="space-y-2 text-sm">Temporary password<Input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave blank to generate one" /><p className="text-muted-foreground">At least 10 characters. The employee must replace it at sign-in. This also activates an unopened invitation and signs out existing sessions.</p></label> : <label className="space-y-2 text-sm">Reason<Input value={reason} onChange={e => setReason(e.target.value)} /><p className="text-muted-foreground">Assignments and history stay intact. Project claiming remains closed.</p></label>}
      {error && <ErrorNote message={error} />}<DialogFooter><Button variant="outline" onClick={() => setAction(null)}>Cancel</Button><Button disabled={reset.isPending || setup.isPending || (action === "password" ? !!password && password.length < 10 : !reason.trim())} onClick={submit}>Save</Button></DialogFooter>
    </DialogContent></Dialog>
    {issued && <TemporaryPasswordDialog name={person.name} password={issued} onClose={() => setIssued(null)} />}
  </section>;
}
