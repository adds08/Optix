"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FolderInput, KeyRound, Mail, UserCheck, UserX, Users } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { EmployeeForm, type EmployeeEditable } from "@/components/employee-form";
import { PostingForm } from "@/components/posting-form";
import { InviteDialog } from "@/components/account-actions";
import { RowActions } from "@/components/sti/row-actions";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { money, idName, shortDate } from "@/lib/format";

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
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const [inviting, setInviting] = useState<{ id: string; name: string; email?: string | null; roleId?: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /* No bulk action reads this yet — turned on for consistency with the other
     registers, which all now offer a checkbox whether or not anything acts
     on the selection. */
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const utils = trpc.useUtils();

  const remove = trpc.employee.delete.useMutation({
    onSuccess: () => {
      setFailed(null);
      utils.employee.list.invalidate();
    },
    onError: (e, vars) => setFailed({ id: vars.id, message: e.message }),
  });

  /*
    Account administration, on the person. These are the procedures `/admin/users`
    used to own — it was deleted on 2026-08-28 because it was a second register
    of the same people. Nothing about them changed; only where they are reached.
  */
  const setActive = trpc.user.setActive.useMutation({
    onSuccess: () => utils.employee.list.invalidate(),
    onError: (e) => setNotice(e.message),
  });
  const resendInvite = trpc.user.resendInvite.useMutation({
    onSuccess: () => setNotice("Invitation sent again."),
    onError: (e) => setNotice(e.message),
  });
  const resetPassword = trpc.user.resetPassword.useMutation({
    onSuccess: () => setNotice("A reset link has been sent."),
    onError: (e) => setNotice(e.message),
  });

  const employees = trpc.employee.list.useQuery();
  const byForeman = trpc.report.byForeman.useQuery();

  const rows = employees.data ?? [];
  const held = new Map((byForeman.data ?? []).map((f) => [f.employeeId, f]));

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
           own convention (see tools/page.tsx's "Tool" column) — this and
           "Primary project" below were both left with NO width until this
           fix, which under `table-fixed` means "share whatever six other
           explicit-width columns didn't claim", squeezed to a couple of
           pixels rather than actually flexible. */
        header: "Name",
        accessorFn: (e) => e.name,
        width: "14rem",
        cell: (e) => (
          <Link href={`/people/${e.id}`} className="font-medium hover:underline">
            {e.name}
          </Link>
        ),
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
      col<EmployeeRow>({
        header: "Primary project",
        accessorFn: (e) => e.primaryProjectName ?? "",
        width: "12rem",
        cell: (e) => (e.primaryProjectName ? idName(e.primaryProjectExternalId, e.primaryProjectName) : "—"),
      }),
      col<EmployeeRow>({ header: "Status", accessorFn: (e) => e.employmentStatus, width: "7rem", cell: (e) => <StatusPill status={e.employmentStatus} /> }),
      col<EmployeeRow>({ header: "Tools held", accessorFn: (e) => Number(held.get(e.id)?.assetCount ?? 0), numeric: true, width: "6rem", cell: (e) => <span className="tnum">{held.get(e.id) ? Number(held.get(e.id)!.assetCount) : 0}</span> }),
      col<EmployeeRow>({ header: "Value held", accessorFn: (e) => Number(held.get(e.id)?.totalValue ?? 0), numeric: true, width: "7rem", cell: (e) => <span className="tnum">{held.get(e.id) ? money(held.get(e.id)!.totalValue) : "—"}</span> }),
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
                    label: "Send a password reset",
                    icon: KeyRound,
                    perm: "user.manage" as const,
                    onSelect: () => resetPassword.mutate({ userId: e.userId! }),
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
    [held, remove.isPending, failed, setActive, resendInvite, resetPassword],
  );

  return (
    <div className="flex flex-col gap-4">
      {editing ? <EmployeeForm open onClose={() => setEditing(null)} edit={editing} /> : null}
      {inviting ? <InviteDialog person={inviting} open onClose={() => setInviting(null)} /> : null}
      {notice ? (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm" role="status">
          {notice}{" "}
          <button className="underline" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
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
        description="Everyone who can hold a tool or sign in — foremen, mechanics, and the account they may or may not have."
        actions={
          <>
            <ImportButton entity="employee" />
            <CreateAction perm="employee.manage" label="New person" Form={EmployeeForm} />
          </>
        }
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
          <EmptyState icon={Users} title="No people on file" />
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
          />
        )}
      </div>
    </div>
  );
}
