"use client";

import { use, useMemo, useState } from "react";
import { equipmentIcon } from "@/lib/equipment-icon";
import Link from "next/link";
import { ArrowLeft, Truck, Wrench } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { Tag, humanize } from "@/components/sti/status";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { VehicleForm, type VehicleEditable } from "@/components/vehicle-form";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { shortDate } from "@/lib/format";

const GPS_LABEL: Record<string, string> = { online: "Online", offline: "Offline", no_signal: "Not set up" };

/*
  One piece of equipment: what it is, and the small tools currently riding on
  it. `asset.list` is filtered client-side by `currentLocationId` — the same
  house convention `/tools` and `/people/[id]` already use, rather than a new
  server-side filter for what is a small, per-vehicle list.
*/
export default function EquipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const vehicles = trpc.vehicle.list.useQuery();
  const assets = trpc.asset.list.useQuery();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const v = vehicles.data?.find((row) => row.id === id);
  const aboard = (assets.data ?? []).filter((a) => v && a.locationId === v.locationId);

  type ToolRow = (typeof aboard)[number];

  const TOOL_COLUMNS: ColumnDef<ToolRow>[] = useMemo(
    () => [
      col<ToolRow>({
        header: "Code",
        accessorFn: (a) => a.serialNumber ?? "",
        width: "9rem",
        cell: (a) => (
          <Link href={`/tools/${a.id}`} className="hover:underline">
            {a.serialNumber ?? <span className="text-muted-foreground">—</span>}
          </Link>
        ),
      }),
      col<ToolRow>({
        header: "Tool",
        accessorFn: (a) => formatAssetModel(a),
        cell: (a) => (
          <Link href={`/tools/${a.id}`} className="hover:underline">
            {formatAssetModel(a) || "Untagged tool"}
          </Link>
        ),
      }),
      col<ToolRow>({
        header: "Category",
        accessorFn: (a) => a.categoryName ?? "",
        width: "9rem",
        cell: (a) => a.categoryName ?? <span className="text-muted-foreground">—</span>,
      }),
    ],
    [],
  );

  if (vehicles.isLoading || assets.isLoading) return <TableSkeleton rows={6} cols={2} />;
  if (vehicles.isError) {
    return <ErrorNote message="The equipment register could not be loaded. Check that the API is running, then reload." />;
  }
  if (!v) {
    return (
      <EmptyState
        icon={Truck}
        title="No such equipment"
        description="It may have been removed, or the link is stale."
      />
    );
  }

  const Icon = equipmentIcon(v.equipmentClass);

  return (
    <div className="flex flex-col gap-4">
      {editing ? (
        <VehicleForm
          open
          onClose={() => setEditing(false)}
          edit={
            {
              id: v.id,
              unit: v.unit,
              vehicleType: v.vehicleType,
              code: v.code,
              description: v.description,
              plate: v.plate,
              makeModel: v.makeModel,
              ownershipType: v.ownershipType,
              projectId: v.projectId,
            } satisfies VehicleEditable
          }
        />
      ) : null}
      <Link
        href="/equipment"
        className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Equipment
      </Link>
      <PageHeader
        icon={Icon}
        title={v.unit}
        description={v.description ?? "No description yet."}
        actions={
          <Can perm="vehicle.manage">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </Can>
        }
      />

      <div className="grid grid-cols-2 gap-4 rounded-md border bg-card p-5 sm:grid-cols-4">
        <Fact label="Code" value={v.code ? <Tag>{v.code}</Tag> : <Muted />} />
        <Fact label="Kind" value={humanize(v.vehicleType)} />
        <Fact label="Make / Model" value={v.makeModel ?? <Muted />} />
        <Fact label="Ownership" value={humanize(v.ownershipType)} />
        <Fact label="Project" value={v.projectName ?? <Muted />} />
        <Fact label="Foreman" value={v.foremanName ?? <Muted />} />
        <Fact
          label="GPS"
          value={GPS_LABEL[v.status] ?? humanize(v.status)}
        />
        <Fact label="Last GPS fix" value={v.gpsAt ? shortDate(v.gpsAt) : <Muted />} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Small tools aboard</h2>
        {!aboard.length ? (
          <EmptyState
            icon={Wrench}
            title="Nothing riding on this one"
            description="Tools handed to this unit's location will show up here."
          />
        ) : (
          <DataTable<ToolRow>
            mode="client"
            columns={TOOL_COLUMNS}
            rows={aboard}
            rowId={(a) => a.id}
            searchPlaceholder="Search tools aboard…"
            enableSelection
            selection={selected}
            onSelectionChange={setSelected}
          />
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function Muted() {
  return <span className="text-muted-foreground">—</span>;
}
