"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FolderInput, HardHat, KeyRound, Mail, UserCheck, UserX, Users } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { SyncFromButton } from "@/components/sync-from-button";
import { EmployeeForm, type EmployeeEditable } from "@/components/employee-form";
import { PostingForm } from "@/components/posting-form";
import { PutOnJobForm } from "@/components/put-on-job-form";
import { InviteDialog, TemporaryPasswordDialog } from "@/components/account-actions";
import { RowActions } from "@/components/sti/row-actions";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { shortDate } from "@/lib/format";

/*
  What a person's login is actually doing, in one phrase.

  The order matters and is not arbitrary — each state is only reachable once the
  one above it is ruled out:

    1. the role says they never sign in, so there is nothing to chase
    2. no account exists
    3. an account exists but the address was never proved (invite unopened)
    4. proved, but never used
    5. live

  "Verified" here means somebody followed a link that only ever existed in that
  mailbox — accepting an invite or completing a reset. There is no separate
  "confirm your email" step and there should not be one; it would ask a person
  to prove the same thing twice.
*/
type AccountFields = {
  roleNeedsLogin: boolean | null;
  userId: string | null;
  userIsActive: boolean | null;
  emailVerifiedAt: Date | string | null;
  lastSignInAt: Date | string | null;
};

function accountState(e: AccountFields): { label: string; muted: boolean } {
  if (e.roleNeedsLogin === false) return { label: "No login needed", muted: true };
  if (!e.userId) return { label: "No account", muted: true };
  if (e.userIsActive === false) return { label: "Deactivated", muted: false };
  if (!e.emailVerifiedAt) return { label: "Invited, not verified", muted: false };
  if (!e.lastSignInAt) return { label: "Never signed in", muted: false };
  return { label: `Last in ${shortDate(e.lastSignInAt)}`, muted: true };
}

export default function PeoplePage() {
  const [editing, setEditing] = useState<EmployeeEditable | null>(null);
  const [moving, setMoving] = useState<{ id: string; name: string; projectId?: string | null } | null>(null);
  /* Seating somebody in a NAMED TIER — the only path in the product that can
     put a person on a job in a tier the code does not hardcode. See
     `put-on-job-form.tsx` for why the other four could not. */
  const [seating, setSeating] = useState<{ id: string; name: string } | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const [inviting, setInviting] = useState<{ id: string; name: string; email?: string | null; roleId?: string | null } | null>(null);
  /* No bulk action reads this yet — turned on for consistency with the other
     registers, which all now offer a checkbox whether or not anything acts
     on the selection. */
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const utils = trpc.useUtils();

  const remove = trpc.employee.delete.useMutation({
    onSuccess: (_d, vars) => {
      setFailed(null);
      utils.employee.list.invalidate();
      /*
        NO UNDO, and that is not an omission. `employee.delete` is a hard
        `db.delete` — there is no soft-delete column to restore from, so an
        "Undo" could only re-INSERT, minting a NEW uuid and a different row that
        merely looks the same. Offering it would be a lie about what happened.
        Real undo needs soft-delete first; see the changelog.

        The blast radius is already narrow by construction: the procedure
        refuses outright if the person holds tools or appears anywhere in
        custody history, telling the caller to terminate them instead.
      */
      const name = rows.find((r) => r.id === vars.id)?.name;
      toast.success("Person deleted", { description: name });
    },
    onError: (e, vars) => {
      /* Inline AS WELL as toasted: `failed` is keyed by row id and renders
         against the row that refused, which is what makes "they are still
         holding tools" actionable. The toast is for somebody who has scrolled. */
      setFailed({ id: vars.id, message: e.message });
      toast.error("Could not delete", { description: e.message });
    },
  });

  /*
    Account administration, on the person. These are the procedures `/admin/users`
    used to own — it was deleted on 2026-08-28 because it was a second register
    of the same people. Nothing about them changed; only where they are reached.
  */
  /* These three all had the same defect in different degrees: `setActive` said
     nothing at all on success, and the other two wrote to a notice banner at
     the TOP of the page — which is not where you are looking when you clicked a
     row action twenty rows down. All three now toast, and `setNotice` is gone
     with the banner it fed. */
  const setActive = trpc.user.setActive.useMutation({
    onSuccess: (_d, vars) => {
      utils.employee.list.invalidate();
      toast.success(vars.isActive ? "Account reactivated" : "Account deactivated");
    },
    onError: (e) => toast.error("Could not change that account", { description: e.message }),
  });
  const resendInvite = trpc.user.resendInvite.useMutation({
    onSuccess: () => toast.success("Invitation sent again"),
    onError: (e) => toast.error("Invitation not sent", { description: e.message }),
  });
  /*
    NOTHING IS EMAILED HERE, and the UI said otherwise for as long as it has
    existed.

    `user.resetPassword` (routers/user.ts) generates a password, hashes it,
    sets `mustChangePassword`, DELETES every session for that user, and returns
    `{ temporaryPassword }`. There is no token, no link and no mail — by
    design, per the note at the top of that file: it is a temporary credential
    an administrator conveys out of band.

    The menu item said "Send a password reset" and the success message said "A
    reset link has been sent", and the call site threw the returned credential
    away. So the real behaviour was: the account's password silently became a
    random string NOBODY had ever seen, every session was revoked, and the
    administrator was told an email had gone out. That locks the person out
    permanently with no recovery path — confirmed the hard way on 2026-09-07,
    when it was fired twice against a real account during testing and had to be
    repaired with a hand-written bcrypt hash.

    The credential now goes on screen, once, where the person who caused it can
    actually pass it on.
  */
  const [resetIssued, setResetIssued] = useState<{ name: string; password: string } | null>(null);
  const resetPassword = trpc.user.resetPassword.useMutation({
    onSuccess: (data) => {
      utils.employee.list.invalidate();
      /* The dialog is armed by the per-call handler at the menu item, which
         has the person's name. This only covers the case where the server
         minted nothing because a password was supplied — not reachable from
         this screen today, handled so it cannot become a silent no-op. */
      if (!data?.temporaryPassword) {
        toast.success("Password reset", { description: "The password you supplied is now active." });
      }
    },
    onError: (e) => toast.error("Password not reset", { description: e.message }),
  });

  const employees = trpc.employee.list.useQuery();

  const rows = employees.data ?? [];

  type EmployeeRow = (typeof rows)[number];

  const EVERYONE_COLUMNS: ColumnDef<EmployeeRow>[] = useMemo(
    () => [
      col<EmployeeRow>({
        header: "Employee Code",
        accessorFn: (e) => e.externalId ?? "",
        width: "8rem",
        cell: (e) => (
          <Link href={`/people/${e.id}`} className="hover:underline">
            {e.externalId ? <Tag>{e.externalId}</Tag> : <span className="text-muted-foreground">—</span>}
          </Link>
        ),
      }),
      col<EmployeeRow>({
        /* The widest column with a declared width, matching the register's
           own convention (see tools/page.tsx's "Tool" column) — left with NO
           width until 2026-08-30, which under `table-fixed` means "share
           whatever other explicit-width columns didn't claim", squeezed to a
           couple of pixels rather than actually flexible. */
        header: "Name",
        accessorFn: (e) => e.name,
        width: "14rem",
        cell: (e) => (
          <Link href={`/people/${e.id}`} className="font-medium hover:underline">
            {e.name}
          </Link>
        ),
      }),
      col<EmployeeRow>({
        header: "Email",
        accessorFn: (e) => e.email ?? "",
        width: "13rem",
        cell: (e) => e.email ?? <span className="text-muted-foreground">—</span>,
      }),
      /* The role register, not the legacy enum. `roleName` is snake_case
         because the seed and the permission matrix name rows by it; nobody
         should ever see that, hence `humanize`. */
      col<EmployeeRow>({
        header: "Role",
        accessorFn: (e) => e.roleName ?? "",
        width: "9rem",
        cell: (e) => (e.roleName ? humanize(e.roleName) : <span className="text-muted-foreground">—</span>),
      }),
      /* The HR fact, not the login role above. This is `jobTitleName` as
         BambooHR calls it and `company_role_id` as the schema does — a person
         can hold a job title with no login at all, which describes most of a
         freshly synced roster. */
      col<EmployeeRow>({
        header: "Job Title",
        accessorFn: (e) => e.jobTitle ?? "",
        width: "11rem",
        cell: (e) => e.jobTitle ?? <span className="text-muted-foreground">—</span>,
      }),
      col<EmployeeRow>({
        header: "Division",
        accessorFn: (e) => e.divisionName ?? "",
        width: "9rem",
        cell: (e) => e.divisionName ?? <span className="text-muted-foreground">—</span>,
      }),
      col<EmployeeRow>({
        header: "Department",
        accessorFn: (e) => e.departmentName ?? "",
        width: "9rem",
        cell: (e) => e.departmentName ?? <span className="text-muted-foreground">—</span>,
      }),
      /*
        The account, on the same row as the person.

        `/admin/users` used to be a second register of the same people, which is
        what made "why are there users and user accounts" a fair question. A
        login is a property of a person, so it belongs in their row.

        Five states, and the first is why `role.needsLogin` exists at all:
        without it "No login needed" and "Not invited" collapse into one blank,
        and every labourer in the yard reads as an outstanding invitation
        forever.
      */
      col<EmployeeRow>({
        header: "Account",
        accessorFn: (e) => accountState(e).label,
        width: "11rem",
        cell: (e) => {
          const a = accountState(e);
          return <span className={a.muted ? "text-muted-foreground" : undefined}>{a.label}</span>;
        },
      }),
      col<EmployeeRow>({ header: "Status", accessorFn: (e) => e.employmentStatus, width: "7rem", cell: (e) => <StatusPill status={e.employmentStatus} /> }),
      /* A SOURCE SYSTEM's opinion, not Optix's own — deliberately a separate
         column from Status above rather than folded into it. BambooHR can say
         somebody is gone while Optix's own Status stays whatever an admin last
         set; that disagreement is exactly what a sync produces on its first
         run and exactly what has no other visible home (see the column
         comment on employee.hrFlaggedInactiveAt). */
      col<EmployeeRow>({
        header: "HR Flag",
        accessorFn: (e) => (e.hrFlaggedInactiveAt ? new Date(e.hrFlaggedInactiveAt).getTime() : 0),
        width: "10rem",
        cell: (e) =>
          e.hrFlaggedInactiveAt ? (
            <span className="text-amber-700 dark:text-amber-500">Reported left {shortDate(e.hrFlaggedInactiveAt)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      }),
      col<EmployeeRow>({
        id: "actions",
        header: "Actions",
        sortable: false,
        stickyRight: true,
        /* One trigger, so this no longer grows with the number of actions. It
           was 9rem for two controls, then 14rem when "Move project" arrived,
           and the last control was still clipped. */
        width: "5rem",
        cell: (e) => (
          <RowActions
            perm="employee.manage"
            label={e.name}
            actions={[
              {
                /* SEATING, distinct from moving. This one names the tier, so it
                   can put somebody on a job as a Director or Area In-charge —
                   which "Move project" below cannot, because
                   `employee.assignToProject` infers the tier from three
                   hardcoded names and silently writes no roster row for
                   anything else. */
                label: "Put on a job…",
                icon: HardHat,
                perm: "project.team.assign" as const,
                onSelect: () => setSeating({ id: e.id, name: e.name }),
              },
              {
                /* Moving somebody to a job is its own action, not an edit — it
                   takes their tools with them. */
                label: "Move project",
                icon: FolderInput,
                onSelect: () => setMoving({ id: e.id, name: e.name, projectId: e.primaryProjectId }),
              },
              /*
                The account lifecycle, offered only in the state it applies to,
                so the menu never shows "Resend invitation" for somebody who has
                never been invited. `user.manage` gates each one — a different
                and rarer authority than `employee.manage`, which is why they
                carry their own `perm` rather than inheriting the menu's.

                A role flagged as not needing a login gets no invite option at
                all. That is the flag earning its place: without it every
                labourer in the yard offers an invitation nobody should send.
              */
              ...(!e.userId && e.roleNeedsLogin !== false
                ? [{
                    label: "Invite to sign in…",
                    icon: Mail,
                    perm: "user.manage" as const,
                    onSelect: () => setInviting({ id: e.id, name: e.name, email: e.email, roleId: e.roleId }),
                  }]
                : []),
              ...(e.userId && !e.emailVerifiedAt
                ? [{
                    label: "Resend invitation",
                    icon: Mail,
                    perm: "user.manage" as const,
                    onSelect: () => resendInvite.mutate({ userId: e.userId! }),
                  }]
                : []),
              ...(e.userId && e.emailVerifiedAt
                ? [{
                    /* "Reset password", NOT "Send a password reset".
                       `user.resetPassword` emails nothing — it generates a
                       temporary credential, returns it to the caller, and
                       revokes every session. See the mutation below. */
                    label: "Reset password",
                    icon: KeyRound,
                    perm: "user.manage" as const,
                    onSelect: () =>
                      resetPassword.mutate(
                        { userId: e.userId! },
                        {
                          /* Per-call, so the row is in closure. `name` is not
                             part of the procedure's input and passing it there
                             would just be stripped by Zod. */
                          onSuccess: (data) => {
                            if (data?.temporaryPassword) {
                              setResetIssued({ name: e.name, password: data.temporaryPassword });
                            }
                          },
                        },
                      ),
                  }]
                : []),
              ...(e.userId
                ? [{
                    label: e.userIsActive ? "Deactivate login" : "Reactivate login",
                    icon: e.userIsActive ? UserX : UserCheck,
                    perm: "user.manage" as const,
                    onSelect: () => setActive.mutate({ userId: e.userId!, isActive: !e.userIsActive }),
                  }]
                : []),
            ]}
            onEdit={() =>
              setEditing({
                id: e.id,
                name: e.name,
                role: e.role,
                roleId: e.roleId,
                email: e.email,
                phone: e.phone,
                externalId: e.externalId,
                employmentStatus: e.employmentStatus,
                reportsToEmployeeId: e.reportsToEmployeeId,
              })
            }
            onDelete={() => remove.mutate({ id: e.id })}
            deleting={remove.isPending}
            error={failed?.id === e.id ? failed.message : null}
          />
        ),
      }),
    ],
    [remove.isPending, failed, setActive, resendInvite, resetPassword],
  );

  return (
    <div className="flex flex-col gap-4">
      {editing ? <EmployeeForm open onClose={() => setEditing(null)} edit={editing} /> : null}
      {inviting ? <InviteDialog person={inviting} open onClose={() => setInviting(null)} /> : null}
      {resetIssued ? (
        <TemporaryPasswordDialog
          name={resetIssued.name}
          password={resetIssued.password}
          onClose={() => setResetIssued(null)}
        />
      ) : null}
      {seating ? (
        <PutOnJobForm
          open
          onClose={() => setSeating(null)}
          employeeId={seating.id}
          employeeName={seating.name}
        />
      ) : null}
      {moving ? (
        <PostingForm
          open
          onClose={() => setMoving(null)}
          employeeId={moving.id}
          employeeName={moving.name}
          currentProjectId={moving.projectId}
        />
      ) : null}
      <PageHeader
        icon={Users}
        title="People"
        hideTitle
      />

      {/* The HR clearance queue and its "Blocks offboarding" hazard band stood
          here until 2026-08-27. Removed on the product call that Urban does not
          want an offboarding gate: a tool can be marked lost, or left on a
          departed person's name, and the ledger is append-only so either is
          reversible. Nothing enforced it anyway — the band's own copy said the
          blocking gate was "specified but not yet built".

          `dashboard.clearanceQueue` and the departure reassignment engine are
          NOT deleted, only unreached. See docs/10-entity-model.md. */}

      {/* No section wrapper or "Everyone" heading — there was never a second
          section for it to disambiguate from, and the register sits directly
          under the page header everywhere else in the app. */}
      <div className="flex flex-col gap-3">
        {employees.isLoading ? (
          <TableSkeleton cols={5} />
        ) : employees.isError ? (
          <ErrorNote message="People could not be loaded." />
        ) : !rows.length ? (
          /* An empty register is exactly when Sync/Import/New Person are the
             actions somebody needs most — they were previously reachable
             ONLY from inside DataTable's toolbar, which this branch never
             renders. A zero-row tenant had no path to stop being one except
             a direct database write. */
          <EmptyState
            icon={Users}
            title="No people on file"
            description="Add people one at a time, import a spreadsheet, or sync from BambooHR."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <SyncFromButton />
                <ImportButton entity="employee" />
                <CreateAction perm="employee.manage" label="New person" Form={EmployeeForm} />
              </div>
            }
          />
        ) : (
          <DataTable<EmployeeRow>
            mode="client"
            columns={EVERYONE_COLUMNS}
            rows={rows}
            rowId={(e) => e.id}
            searchPlaceholder="Search people…"
            enableSelection
            selection={selectedIds}
            onSelectionChange={setSelectedIds}
            toolbarExtra={
              <>
                <SyncFromButton />
                <ImportButton entity="employee" />
                <CreateAction perm="employee.manage" label="New person" Form={EmployeeForm} />
              </>
            }
          />
        )}
      </div>
    </div>
  );
}
