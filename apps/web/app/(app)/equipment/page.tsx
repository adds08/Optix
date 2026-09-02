"use client";

import { useMemo, useState } from "react";
import { equipmentIcon, equipmentClassLabel } from "@/lib/equipment-icon";
import Link from "next/link";
import { Truck } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { Tag, humanize } from "@/components/sti/status";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { VehicleForm, type VehicleEditable } from "@/components/vehicle-form";
import { RowActions } from "@/components/sti/row-actions";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { cn } from "@/lib/utils";

/*
  The equipment register — trucks and trailers today, heavy plant (excavator,
  loader, backhoe...) the moment a row with `equipmentClass: "heavy"` exists.
  Small tools are NOT here — `asset` is that register, and the two are
  deliberately separate entities (see `.claude/rules/web.md`).

  Same shape as `/tools` and `/projects`: DataTable, code before name, one
  frozen actions column. `vehicle.list` already reads every field this needs,
  including GPS status (`vehicleStatus`, computed server-side so this page and
  the fleet map can never disagree about whether a unit is online).
*/

const GPS_LABEL: Record<string, string> = { online: "Online", offline: "Offline", no_signal: "Not set up" };
const GPS_TONE: Record<string, string> = {
  online: "text-ok",
  offline: "text-warn",
  no_signal: "text-muted-foreground",
};

function GpsBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", GPS_TONE[status] ?? "text-muted-foreground")}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {GPS_LABEL[status] ?? humanize(status)}
    </span>
  );
}

export default function EquipmentPage() {
  const [editing, setEditing] = useState<VehicleEditable | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const utils = trpc.useUtils();

  const remove = trpc.vehicle.delete.useMutation({
    onSuccess: () => {
      setFailed(null);
      utils.vehicle.list.invalidate();
    },
    onError: (e, vars) => setFailed({ id: vars.id, message: e.message }),
  });

  const vehicles = trpc.vehicle.list.useQuery();
  const rows = vehicles.data ?? [];

  type Row = (typeof rows)[number];

  const TABLE_COLUMNS: ColumnDef<Row>[] = useMemo(
    () => [
      col<Row>({
        header: "Code",
        accessorFn: (v) => v.code ?? "",
        width: "8rem",
        cell: (v) => (
          <Link href={`/equipment/${v.id}`} className="hover:underline">
            {v.code ? <Tag>{v.code}</Tag> : <span className="text-muted-foreground">—</span>}
          </Link>
        ),
      }),
      col<Row>({
        header: "Equipment",
        accessorFn: (v) => v.unit,
        width: "14rem",
        /* Heavy vs. vehicle is a capability of the row, not a fact worth its
           own column — an icon on the name carries it instead, the same
           reasoning `ToolIcon` on /tools rides the category icon on the name. */
        cell: (v) => {
          const Icon = equipmentIcon(v.equipmentClass);
          return (
            <Link href={`/equipment/${v.id}`} className="group/eq flex items-center gap-2">
              <Icon
                className="size-4 shrink-0 text-muted-foreground"
                aria-label={equipmentClassLabel(v.equipmentClass)}
              />
              <span className="font-medium group-hover/eq:underline">{v.unit}</span>
            </Link>
          );
        },
      }),
      col<Row>({
        header: "Make / Model",
        accessorFn: (v) => v.makeModel ?? "",
        width: "12rem",
        cell: (v) => v.makeModel ?? <span className="text-muted-foreground">—</span>,
      }),
      col<Row>({
        header: "Ownership",
        accessorFn: (v) => v.ownershipType,
        width: "10rem",
        cell: (v) => humanize(v.ownershipType),
      }),
      col<Row>({
        header: "Project",
        accessorFn: (v) => v.projectName ?? "",
        width: "10rem",
        cell: (v) => v.projectName ?? <span className="text-muted-foreground">—</span>,
      }),
      col<Row>({
        header: "GPS",
        accessorFn: (v) => v.status,
        width: "8rem",
        cell: (v) => <GpsBadge status={v.status} />,
      }),
      col<Row>({
        id: "actions",
        header: "Actions",
        sortable: false,
        stickyRight: true,
        width: "5rem",
        cell: (v) => (
          <RowActions
            perm="vehicle.manage"
            label={v.unit}
            onEdit={() =>
              setEditing({
                id: v.id,
                unit: v.unit,
                vehicleType: v.vehicleType,
                equipmentClass: v.equipmentClass,
                vin: v.vin,
                code: v.code,
                description: v.description,
                plate: v.plate,
                makeModel: v.makeModel,
                ownershipType: v.ownershipType,
                projectId: v.projectId,
              })
            }
            onDelete={() => remove.mutate({ id: v.id })}
            deleting={remove.isPending}
            error={failed?.id === v.id ? failed.message : null}
          />
        ),
      }),
    ],
    [remove.isPending, failed],
  );

  return (
    <div className="flex flex-col gap-4">
      {editing ? <VehicleForm open onClose={() => setEditing(null)} edit={editing} /> : null}
      <PageHeader
        icon={Truck}
        title="Equipment"
        hideTitle
        description="Trucks and trailers today, heavy plant when it joins the register — the fleet, not the small tools riding on it."
        actions={
          <>
            <ImportButton entity="vehicle" />
            <CreateAction perm="vehicle.manage" label="New equipment" Form={VehicleForm} />
          </>
        }
      />
      {vehicles.isLoading ? (
        <TableSkeleton />
      ) : vehicles.isError ? (
        <ErrorNote message="The equipment register could not be loaded. Check that the API is running, then reload." />
      ) : !rows.length ? (
        <EmptyState
          icon={Truck}
          title="No equipment registered yet"
          description="Import the fleet, or register the first truck or trailer."
        />
      ) : (
        <DataTable<Row>
          mode="client"
          columns={TABLE_COLUMNS}
          rows={rows}
          rowId={(v) => v.id}
          searchPlaceholder="Search equipment…"
          storageKey="equipment-register"
          enableSelection
          selection={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      )}
    </div>
  );
}
