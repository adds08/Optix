"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound, ShieldCheck, ShieldOff, UserCog, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNote, TableSkeleton, TableWrap } from "@/components/sti/page";
import { CreateAction } from "@/components/sti/create-action";
import { UserForm, CredentialNote } from "@/components/user-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/*
  Users & Access — the login accounts.

  The distinction this screen exists to keep visible: **an account is not a
  person.** `/people` is the register of who holds tools; this is the register
  of who can sign in. The two are linked by an optional uuid with no foreign
  key behind it, and a foreman with nineteen tools on his truck may quite
  correctly have no row here at all.

  Which is why the "Tools held" column is read-only and the deactivate dialog
  refuses to act on it. Deactivating an account stops somebody signing in; it
  says nothing about where their tools are, and moving them is departure
  reassignment on the person's own page. A single button doing both is how a
  tool ends up with no custodian and no event explaining it.
*/

const SELECT_CLASS =
  "flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default function AdminUsersPage() {
  const utils = trpc.useUtils();
  /* Read straight from `identity.me` rather than through `usePermissions`,
     because this page needs the LOADING state as well as the answer: a helper
     that only says yes/no reports "no" for the first paint, and the screen
     would flash "you do not have access" at the person who does. */
  const me = trpc.identity.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes("config.manage");
  const users = trpc.user.list.useQuery(undefined, { enabled: canManage });
  const roles = trpc.user.roles.useQuery(undefined, { enabled: canManage });

  /* Derived rather than restated, so a column added to `user.list` cannot
     silently disagree with the shape this page believes it is rendering. */
  type UserRow = NonNullable<typeof users.data>[number];
  const rows: UserRow[] = users.data ?? [];

  const [confirming, setConfirming] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  /* A role change the admin has picked but not yet confirmed. Nothing is sent
     until they press the button in the dialog — see the select below. */
  const [roleChange, setRoleChange] = useState<{ user: UserRow; roleId: string | null } | null>(null);
  const [issued, setIssued] = useState<{ email: string; password: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => utils.user.list.invalidate();

  /*
    STI-204: `e.message` is machine text. The formatter in `trpc.ts` redacts it
    on anything internal and hands the readable half over as
    `data.userMessage`, non-null exactly when the text was written to be shown —
    a zod input failure, for instance, carries a raw issue array in `message`
    and a deliberate null here. Rendering `message` put
    `[{"validation":"uuid",...}]` in front of the desk as if it were guidance.
  */
  const shown = (e: { data?: { userMessage?: string | null } | null }, fallback: string) =>
    e.data?.userMessage ?? fallback;

  const setRole = trpc.user.setRole.useMutation({
    onSuccess: () => { setError(null); setRoleChange(null); invalidate(); },
    onError: (e) => {
      setError(shown(e, "That role could not be changed. Try again, or ask another administrator."));
      setRoleChange(null);
    },
  });
  const setActive = trpc.user.setActive.useMutation({
    onSuccess: () => { setError(null); setConfirming(null); invalidate(); },
    onError: (e) => {
      setError(shown(e, "That account could not be changed. Try again, or ask another administrator."));
      setConfirming(null);
    },
  });
  const resetPassword = trpc.user.resetPassword.useMutation({
    onSuccess: (res, vars) => {
      setError(null);
      const target = rows.find((r) => r.id === vars.userId);
      setIssued({ email: target?.email ?? "", password: res.temporaryPassword });
      setResetting(null);
    },
    onError: (e) => {
      setError(shown(e, "The password could not be reset. Try again, or ask another administrator."));
      setResetting(null);
    },
  });

  /* The rail hides this page from anyone without the permission, and the
     procedures refuse the calls regardless. This is the third layer, for the
     person who typed the URL. */
  if (me.isLoading) return <TableSkeleton cols={6} />;
  if (!canManage) {
    return (
      <EmptyState
        icon={UserCog}
        title="Accounts are managed by the equipment desk"
        description="You need the configuration permission to see who can sign in."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <UserCog className="size-4 text-muted-foreground" aria-hidden />
          Users &amp; Access
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <CreateAction perm="config.manage" label="New user" Form={UserForm} />
        </div>
      </div>

      <p className="max-w-[76ch] text-sm text-muted-foreground">
        These are sign-in accounts. The people who hold tools live on{" "}
        <Link href="/people" className="underline underline-offset-4">People</Link> and do not need
        an account — link one here only when somebody actually signs in. Accounts are deactivated,
        never deleted: they are named as the actor on history that cannot be rewritten.
      </p>

      {error ? <ErrorNote message={error} /> : null}

      {users.isLoading || users.isPending ? (
        <TableSkeleton cols={6} />
      ) : users.isError ? (
        <ErrorNote message="Accounts could not be loaded." />
      ) : !rows.length ? (
        <EmptyState
          icon={UserCog}
          title="No accounts yet"
          description="Create the first sign-in account for the equipment desk."
        />
      ) : (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="w-[12rem]">Role</TableHead>
                <TableHead>Linked person</TableHead>
                <TableHead className="w-[8rem]">Tools held</TableHead>
                <TableHead className="w-[7rem]">Status</TableHead>
                <TableHead className="w-[14rem] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => (
                <TableRow key={u.id} className={u.isActive ? undefined : "opacity-60"}>
                  <TableCell>
                    <div className="font-medium">{u.firstName} {u.lastName}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    {/* Picking does NOT commit. A dropdown that mutated on
                        change meant one mis-click silently rewrote somebody's
                        permissions — and picking "No role" on your own row took
                        `config.manage` off the account doing the picking, with
                        no undo and, if you were the last administrator, nobody
                        left who could put it back. The server refuses that case
                        outright; this dialog is what stops the other cases
                        happening by accident. */}
                    <select
                      className={SELECT_CLASS}
                      value={u.roleId ?? ""}
                      disabled={setRole.isPending}
                      onChange={(e) => setRoleChange({ user: u, roleId: e.target.value || null })}
                    >
                      <option value="">No role</option>
                      {roles.data?.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    {u.employeeId && u.employeeName ? (
                      <Link href={`/people/${u.employeeId}`} className="underline underline-offset-4">
                        {u.employeeName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Not linked</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* Read-only, always. This number is a fact about the linked
                        employee, and nothing on this screen may act on it. */}
                    {u.heldToolCount > 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <Wrench className="size-3.5 text-muted-foreground" aria-hidden />
                        <span className="tnum">{u.heldToolCount}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.isActive ? "secondary" : "outline"}>
                      {u.isActive ? "Active" : "Deactivated"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setResetting(u)}>
                        <KeyRound className="size-3.5" aria-hidden />
                        Reset
                      </Button>
                      {u.isActive ? (
                        <Button size="sm" variant="outline" onClick={() => setConfirming(u)}>
                          <ShieldOff className="size-3.5" aria-hidden />
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={setActive.isPending}
                          onClick={() => setActive.mutate({ userId: u.id, isActive: true })}
                        >
                          <ShieldCheck className="size-3.5" aria-hidden />
                          Reactivate
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      )}

      {/* Confirm a role change. The select above only proposes one. */}
      <Dialog open={!!roleChange} onOpenChange={(o) => !o && setRoleChange(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Change {roleChange?.user.firstName} {roleChange?.user.lastName}&rsquo;s role?
            </DialogTitle>
          </DialogHeader>
          {roleChange ? (
            <div className="space-y-3 text-sm">
              <p>
                <span className="text-muted-foreground">{roleChange.user.roleName ?? "No role"}</span>
                {" → "}
                <span className="font-medium">
                  {roles.data?.find((r) => r.id === roleChange.roleId)?.name ?? "No role"}
                </span>
                . This takes effect on their next request; it does not sign them out and it does not
                move any tools.
              </p>
              {roleChange.roleId === null ? (
                <div className="rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-warn">
                  With no role they can still sign in and will see nothing at all. That is not the
                  same as deactivating the account.
                </div>
              ) : null}
              {me.data?.id === roleChange.user.id ? (
                <div className="rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-warn">
                  This is your own account. Changing it to a role without the configuration
                  permission would leave you unable to reach this screen, so the server refuses it —
                  ask another administrator instead.
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleChange(null)}>Cancel</Button>
            <Button
              variant={roleChange?.roleId === null ? "destructive" : "default"}
              disabled={setRole.isPending}
              onClick={() =>
                roleChange && setRole.mutate({ userId: roleChange.user.id, roleId: roleChange.roleId })
              }
            >
              {setRole.isPending ? "Changing…" : "Change role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate. The held-tools sentence is the whole reason this is a
          dialog rather than a button: the admin must see that the tools stay
          exactly where they are, and where to go to move them. */}
      <Dialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Deactivate {confirming?.firstName} {confirming?.lastName}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              They will not be able to sign in, and any session they have open stops working at its
              next request. The account is kept — it is named on history that cannot be rewritten —
              and you can reactivate it here at any time.
            </p>
            {confirming && confirming.heldToolCount > 0 ? (
              <div className="rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-warn">
                <p className="font-medium">
                  {confirming.employeeName ?? "The linked person"} still holds{" "}
                  {confirming.heldToolCount} tool{confirming.heldToolCount === 1 ? "" : "s"}.
                </p>
                <p className="mt-1">
                  Deactivating the account does <span className="font-medium">not</span> move them.
                  Tools follow the person, not the login — reassign them from{" "}
                  {confirming.employeeId ? (
                    <Link href={`/people/${confirming.employeeId}`} className="underline underline-offset-4">
                      their page on People
                    </Link>
                  ) : (
                    "the People register"
                  )}
                  .
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={setActive.isPending}
              onClick={() => confirming && setActive.mutate({ userId: confirming.id, isActive: false })}
            >
              {setActive.isPending ? "Deactivating…" : "Deactivate account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset. Two dialogs rather than one, because the credential must survive
          the click that produced it — see CredentialNote. */}
      <Dialog open={!!resetting} onOpenChange={(o) => !o && setResetting(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reset the password for {resetting?.email}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            A new password is generated and shown to you once. Every session this account has open
            is revoked, so an old sign-in cannot outlive the reset.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetting(null)}>Cancel</Button>
            <Button
              disabled={resetPassword.isPending}
              onClick={() => resetting && resetPassword.mutate({ userId: resetting.id })}
            >
              {resetPassword.isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New password</DialogTitle>
          </DialogHeader>
          {issued ? <CredentialNote email={issued.email} password={issued.password} /> : null}
          <DialogFooter>
            <Button onClick={() => setIssued(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
