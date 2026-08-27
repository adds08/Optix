"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FolderInput, Users } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { trpc } from "@/lib/trpc";
import { TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { StatusPill, humanize } from "@/components/sti/status";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { EmployeeForm, type EmployeeEditable } from "@/components/employee-form";
import { PostingForm } from "@/components/posting-form";
import { RowActions } from "@/components/sti/row-actions";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { money, idName } from "@/lib/format";

export default function PeoplePage() {
  const [editing, setEditing] = useState<EmployeeEditable | null>(null);
  const [moving, setMoving] = useState<{ id: string; name: string; projectId?: string | null } | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const utils = trpc.useUtils();

  const remove = trpc.employee.delete.useMutation({
    onSuccess: () => {
      setFailed(null);
      utils.employee.list.invalidate();
    },
    onError: (e, vars) => setFailed({ id: vars.id, message: e.message }),
  });

  const employees = trpc.employee.list.useQuery();
  const byForeman = trpc.report.byForeman.useQuery();

  const rows = employees.data ?? [];
  const held = new Map((byForeman.data ?? []).map((f) => [f.employeeId, f]));

  type EmployeeRow = (typeof rows)[number];

  const EVERYONE_COLUMNS: ColumnDef<EmployeeRow>[] = useMemo(
    () => [
      col<EmployeeRow>({
        header: "Name",
        accessorFn: (e) => idName(e.externalId, e.name),
        cell: (e) => (
          <Link href={`/people/${e.id}`} className="font-medium hover:underline">
            {idName(e.externalId, e.name)}
          </Link>
        ),
      }),
      col<EmployeeRow>({ header: "Role", accessorFn: (e) => e.role, width: "8rem", cell: (e) => humanize(e.role) }),
      col<EmployeeRow>({
        header: "Primary project",
        accessorFn: (e) => e.primaryProjectName ?? "",
        cell: (e) => (e.primaryProjectName ? idName(e.primaryProjectExternalId, e.primaryProjectName) : "—"),
      }),
      col<EmployeeRow>({ header: "Status", accessorFn: (e) => e.employmentStatus, width: "7rem", cell: (e) => <StatusPill status={e.employmentStatus} /> }),
      col<EmployeeRow>({ header: "Tools held", accessorFn: (e) => Number(held.get(e.id)?.assetCount ?? 0), numeric: true, width: "6rem", cell: (e) => <span className="tnum">{held.get(e.id) ? Number(held.get(e.id)!.assetCount) : 0}</span> }),
      col<EmployeeRow>({ header: "Value held", accessorFn: (e) => Number(held.get(e.id)?.totalValue ?? 0), numeric: true, width: "7rem", cell: (e) => <span className="tnum">{held.get(e.id) ? money(held.get(e.id)!.totalValue) : "—"}</span> }),
      col<EmployeeRow>({
        id: "actions",
        header: "",
        sortable: false,
        /* One trigger, so this no longer grows with the number of actions. It
           was 9rem for two controls, then 14rem when "Move project" arrived,
           and the last control was still clipped. */
        width: "4rem",
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
            ]}
            onEdit={() =>
              setEditing({
                id: e.id,
                name: e.name,
                role: e.role,
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
    [held, remove.isPending, failed],
  );

  return (
    <div className="flex flex-col gap-6">
      {editing ? <EmployeeForm open onClose={() => setEditing(null)} edit={editing} /> : null}
      {moving ? (
        <PostingForm
          open
          onClose={() => setMoving(null)}
          employeeId={moving.id}
          employeeName={moving.name}
          currentProjectId={moving.projectId}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="size-4 text-muted-foreground" aria-hidden />
          People
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <ImportButton entity="employee" />
          <CreateAction perm="employee.manage" label="New person" Form={EmployeeForm} />
        </div>
      </div>

      {/* The HR clearance queue and its "Blocks offboarding" hazard band stood
          here until 2026-08-27. Removed on the product call that Urban does not
          want an offboarding gate: a tool can be marked lost, or left on a
          departed person's name, and the ledger is append-only so either is
          reversible. Nothing enforced it anyway — the band's own copy said the
          blocking gate was "specified but not yet built".

          `dashboard.clearanceQueue` and the departure reassignment engine are
          NOT deleted, only unreached. See docs/10-entity-model.md. */}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Everyone</h2>
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
          />
        )}
      </section>
    </div>
  );
}
