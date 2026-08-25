"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FolderInput, Users } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { HazardBand } from "@/components/sti/construction";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
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
  const clearance = trpc.dashboard.clearanceQueue.useQuery();

  const rows = employees.data ?? [];
  const held = new Map((byForeman.data ?? []).map((f) => [f.employeeId, f]));

  type EmployeeRow = (typeof rows)[number];
  type ClearanceRow = NonNullable<(typeof clearance.data)>[number];

  const CLEARANCE_COLUMNS: ColumnDef<ClearanceRow>[] = useMemo(
    () => [
      col<ClearanceRow>({ header: "Tag", accessorFn: (c) => c.tag ?? "", cell: (c) => <Tag>{c.tag}</Tag> }),
      col<ClearanceRow>({ header: "Model", accessorFn: (c) => formatAssetModel(c), cell: (c) => <span className="font-medium">{formatAssetModel(c) || "Untagged tool"}</span> }),
      col<ClearanceRow>({ header: "Last custodian", accessorFn: (c) => c.custodianName ?? "", cell: (c) => c.custodianName ?? "—" }),
      col<ClearanceRow>({ header: "Status", accessorFn: (c) => c.status ?? "", width: "8rem", cell: (c) => <StatusPill status={c.status} /> }),
      col<ClearanceRow>({ header: "Value", accessorFn: (c) => Number(c.cost ?? 0), numeric: true, width: "7rem", cell: (c) => <span className="tnum">{money(c.cost)}</span> }),
    ],
    [],
  );

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

      {/* Clearance first — it's the thing with a deadline attached. The
          hazard band is what "blocks offboarding" actually means: not an
          error, a condition that keeps blocking until somebody acts. */}
      {clearance.data?.length ? (
        <section className="flex flex-col gap-3">
          <HazardBand title="Blocks offboarding">
            {clearance.data.length} tool{clearance.data.length === 1 ? "" : "s"} worth{" "}
            {money(clearance.data.reduce((n, c) => n + Number(c.cost ?? 0), 0))} must be returned,
            transferred, or marked lost before offboarding is signed off. The blocking gate itself
            is specified but not yet built.
          </HazardBand>
          <DataTable<ClearanceRow>
            mode="client"
            columns={CLEARANCE_COLUMNS}
            rows={clearance.data}
            rowId={(c) => c.tag ?? `${c.modelNumber ?? "tool"}-${Math.random()}`}
            searchPlaceholder="Search the clearance queue…"
            filename="hr-clearance-queue"
          />
        </section>
      ) : null}

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
