"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { UserMinus, Users } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { TableSkeleton, ErrorNote, EmptyState, Metric } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { EmployeeForm, type EmployeeEditable } from "@/components/employee-form";
import { PostingForm } from "@/components/posting-form";
import { RowActions } from "@/components/sti/row-actions";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
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
  const terminated = rows.filter((e) => e.employmentStatus === "terminated");

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
        width: "9rem",
        cell: (e) => (
          <RowActions
            perm="employee.manage"
            label={e.name}
            /* Moving somebody to a job is its own action, not an edit — it
               takes their tools with them. */
            extra={
              <Can perm="employee.manage">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMoving({ id: e.id, name: e.name, projectId: e.primaryProjectId })}
                >
                  Move project
                </Button>
              </Can>
            }
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
        <h1 className="text-lg font-semibold">People</h1>
        <div className="ml-auto flex items-center gap-2">
          <ImportButton entity="employee" />
          <CreateAction perm="employee.manage" label="New person" Form={EmployeeForm} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Active" value={rows.filter((e) => e.employmentStatus === "active").length} loading={employees.isLoading} />
        <Metric label="Terminated" value={terminated.length} loading={employees.isLoading} tone={terminated.length ? "warn" : "default"} />
        <Metric
          label="Held by terminated staff"
          value={clearance.data?.length ?? 0}
          loading={clearance.isLoading}
          tone={clearance.data?.length ? "crit" : "ok"}
          hint="blocks offboarding sign-off"
        />
      </div>

      {/* Clearance first — it's the thing with a deadline attached. */}
      {clearance.data?.length ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <UserMinus className="size-4 text-crit" />
            <h2 className="text-sm font-medium">HR clearance queue</h2>
          </div>
          <DataTable<ClearanceRow>
            mode="client"
            columns={CLEARANCE_COLUMNS}
            rows={clearance.data}
            rowId={(c) => c.tag ?? `${c.modelNumber ?? "tool"}-${Math.random()}`}
            searchPlaceholder="Search the clearance queue…"
            filename="hr-clearance-queue"
          />
          <p className="text-sm text-muted-foreground">
            Each of these must be returned, transferred, or marked lost before offboarding is
            signed off. The blocking gate itself is specified but not yet built.
          </p>
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
