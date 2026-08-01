"use client";

import { useState } from "react";
import { Download, MapPin, Radio } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, TableWrap, Metric } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { LocationForm, type LocationEditable } from "@/components/location-form";
import { VehicleForm, type VehicleEditable } from "@/components/vehicle-form";
import { RowActions } from "@/components/sti/row-actions";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { ContainerCustodyForm } from "@/components/container-custody-form";
import { downloadCsv } from "@/lib/csv";
import { exportAssetsToSpec } from "@/lib/export-assets";
import { relative } from "@/lib/format";

/*
  Every place a tool can be — including trucks and trailers.

  These are NOT a fleet to manage. A truck matters here because it is a
  location that moves: it answers "where is UIC-1012?" with "Truck 12", and
  its GPS gives the tools on board a position. No mileage, no service
  schedules, no driver rosters.
*/
export default function LocationsPage() {
  /* The container whose custody is being changed, if any. */
  const [handing, setHanding] = useState<{
    id: string;
    name: string;
    custodianId?: string | null;
    custodianName?: string | null;
    toolCount: number;
  } | null>(null);
  const [editingLoc, setEditingLoc] = useState<LocationEditable | null>(null);
  const [editingVeh, setEditingVeh] = useState<VehicleEditable | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const utils = trpc.useUtils();

  const invalidate = () => {
    setFailed(null);
    utils.location.list.invalidate();
    utils.vehicle.list.invalidate();
  };
  const removeLoc = trpc.location.delete.useMutation({
    onSuccess: invalidate,
    onError: (e, vars) => setFailed({ id: vars.id, message: e.message }),
  });
  const removeVeh = trpc.vehicle.delete.useMutation({
    onSuccess: invalidate,
    onError: (e, vars) => setFailed({ id: vars.id, message: e.message }),
  });

  const locations = trpc.location.list.useQuery();
  const vehicles = trpc.vehicle.list.useQuery();
  const assets = trpc.asset.list.useQuery({});

  const locs = locations.data ?? [];
  const vehs = vehicles.data ?? [];

  /* How many tools sit at each location — the only number that matters here. */
  const countByLocation = new Map<string, number>();
  for (const a of assets.data ?? []) {
    if (a.locationId) countByLocation.set(a.locationId, (countByLocation.get(a.locationId) ?? 0) + 1);
  }

  const movable = locs.filter((l) => l.type === "vehicle");
  const fixed = locs.filter((l) => l.type !== "vehicle");

  /*
    One trailer's sheet, in the importer's own columns.
    The trailer sheets start with a title block — the trailer number, the
    foreman, the project — and the importer's header detection already knows
    how to skip it, so the export mirrors the source format exactly.
  */
  const exportLocation = (name: string, locationId: string | null) => {
    const rows = (assets.data ?? [])
      .filter((a) => a.locationId === locationId)
      .map((r) => ({
        tag: r.tag,
        make: r.make,
        modelNumber: r.modelNumber,
        description: r.description,
        categoryName: r.categoryName,
        serialNumber: r.serialNumber,
        quantity: r.quantity,
        acquisitionCost: r.acquisitionCost,
        acquisitionDate: r.acquisitionDate,
        warrantyExpiresOn: r.warrantyExpiresOn,
        condition: r.condition,
        otherRef: r.otherRef ?? null,
        locationName: r.locationName,
        owningProjectName: r.owningProjectName,
      }));
    downloadCsv(`stinventory-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, exportAssetsToSpec(rows, name));
  };

  /*
    A unit with a live tracker reads "Online"; one that reported and stopped
    reads "Offline"; one that never reported reads "No signal". The last case
    is a fault on a company truck and entirely normal on a foreman's own
    personal-allowance truck — the pill copy says which, because a red "no
    signal" on a truck that was never meant to have a tracker would send
    somebody to the yard for nothing.
  */
  const gpsPill = (v: (typeof vehs)[number]) => {
    if (v.status === "online") return <StatusPill status="online" label="Online" />;
    if (v.status === "offline") return <StatusPill status="offline" label="Offline" />;
    return v.ownershipType === "personal_allowance" ? (
      <span className="text-xs text-muted-foreground" title="Personal-allowance truck — no tracker installed">
        No tracker
      </span>
    ) : (
      <StatusPill status="no_signal" label="No signal" />
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {editingLoc ? <LocationForm open onClose={() => setEditingLoc(null)} edit={editingLoc} /> : null}
      {editingVeh ? <VehicleForm open onClose={() => setEditingVeh(null)} edit={editingVeh} /> : null}
      {handing ? (
        <ContainerCustodyForm
          open
          onClose={() => setHanding(null)}
          locationId={handing.id}
          locationName={handing.name}
          currentCustodianId={handing.custodianId}
          currentCustodianName={handing.custodianName}
          toolCount={handing.toolCount}
        />
      ) : null}
      <PageHeader
        eyebrow="Equipment"
        title="Locations"
        description="Every place a tool can be — yards, containers, gang boxes, and the trucks and trailers that carry them around."
        actions={
          <>
            <ImportButton entity="location" />
            <ImportButton entity="vehicle" />
            <CreateAction perm="location.manage" label="New location" Form={LocationForm} />
            <CreateAction perm="vehicle.manage" label="New vehicle" Form={VehicleForm} />
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Fixed locations" value={fixed.length} loading={locations.isLoading} hint="yards, containers, gang boxes" />
        <Metric label="On wheels" value={movable.length} loading={locations.isLoading} hint="trucks and trailers" />
        <Metric label="Tools placed" value={countByLocation.size ? Array.from(countByLocation.values()).reduce((a, b) => a + b, 0) : 0} loading={assets.isLoading} />
      </div>

      {locations.isLoading ? (
        <TableSkeleton cols={4} />
      ) : locations.isError ? (
        <ErrorNote message="Locations could not be loaded." />
      ) : !locs.length ? (
        <EmptyState icon={MapPin} title="No locations defined" description="Add a warehouse or container to start placing tools." />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Fixed</h2>
            <TableWrap>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["Name", "Type", "Held by", "Warehouse", "Project", "Tools here", ""].map((h, i) => (
                      <th key={h || "actions"} className={`label-xs px-4 py-2.5 ${i >= 5 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fixed.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2.5 font-medium">{l.name}</td>
                      <td className="px-4 py-2.5">{humanize(l.type)}</td>
                      {/* A gang box travels with whoever loaded it; a yard travels
                          with nobody. Both are legitimate answers. */}
                      <td className="px-4 py-2.5">
                        {l.custodianName ?? <span className="text-muted-foreground">nobody carries it</span>}
                      </td>
                      <td className="px-4 py-2.5">{l.warehouseName ?? "—"}</td>
                      <td className="px-4 py-2.5">{l.projectName ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tnum">{countByLocation.get(l.id) ?? 0}</td>
                      <td className="px-4 py-2.5">
                        <RowActions
                          perm="location.manage"
                          label={l.name}
                          /* Warehouses and project sites are places, not things
                             anyone carries — only containers get handed over. */
                          extra={
                            <>
                              {l.type === "warehouse" || l.type === "project_site" ? null : (
                                <Can perm="location.manage">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setHanding({
                                        id: l.id,
                                        name: l.name,
                                        custodianId: l.custodianEmployeeId,
                                        custodianName: l.custodianName,
                                        toolCount: countByLocation.get(l.id) ?? 0,
                                      })
                                    }
                                  >
                                    {l.custodianEmployeeId ? "Change" : "Hand over"}
                                  </Button>
                                </Can>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => exportLocation(l.name, l.id)}
                                title="Download this location's tools in the import format"
                              >
                                <Download className="size-3.5" aria-hidden />
                                Export
                              </Button>
                            </>
                          }
                          onEdit={() =>
                            setEditingLoc({
                              id: l.id,
                              name: l.name,
                              type: l.type,
                              warehouseId: l.warehouseId,
                              projectId: l.projectId,
                            })
                          }
                          onDelete={() => removeLoc.mutate({ id: l.id })}
                          deleting={removeLoc.isPending}
                          error={failed?.id === l.id ? failed.message : null}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">On wheels</h2>
            <p className="text-sm text-muted-foreground">
              Tools loaded on these inherit their position, so a tool in a truck is never
              &ldquo;missing&rdquo; — it is wherever the truck is.
            </p>
            {vehicles.isLoading ? (
              <TableSkeleton cols={5} />
            ) : !vehs.length ? (
              <EmptyState title="No trucks or trailers registered" />
            ) : (
              <TableWrap>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {["Unit", "Type", "Held by", "Project", "Last position", "GPS", "Tools aboard", ""].map((h, i) => (
                        <th key={h || "actions"} className={`label-xs px-4 py-2.5 ${i >= 6 ? "text-right" : "text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vehs.map((v) => (
                      <tr key={v.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-2.5"><Tag>{v.unit}</Tag></td>
                        <td className="px-4 py-2.5 capitalize">{v.vehicleType}</td>
                        <td className="px-4 py-2.5">{v.foremanName ?? "—"}</td>
                        <td className="px-4 py-2.5">{v.projectName ?? "—"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {v.gpsAt ? relative(v.gpsAt) : "no signal yet"}
                        </td>
                        <td className="px-4 py-2.5 text-right">{gpsPill(v)}</td>
                        <td className="px-4 py-2.5 text-right tnum">
                          {v.locationId ? (countByLocation.get(v.locationId) ?? 0) : 0}
                        </td>
                        <td className="px-4 py-2.5">
                          <RowActions
                            perm="vehicle.manage"
                            label={v.unit}
                            extra={
                              <>
                                <Can perm="location.manage">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!v.locationId}
                                    onClick={() =>
                                      setHanding({
                                        id: v.locationId!,
                                        name: v.unit,
                                        custodianId: v.foremanEmployeeId,
                                        custodianName: v.foremanName,
                                        toolCount: v.locationId ? (countByLocation.get(v.locationId) ?? 0) : 0,
                                      })
                                    }
                                  >
                                    {v.foremanEmployeeId ? "Change" : "Hand over"}
                                  </Button>
                                </Can>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!v.locationId}
                                  onClick={() => exportLocation(v.unit, v.locationId)}
                                  title="Download this vehicle's tools in the import format"
                                >
                                  <Download className="size-3.5" aria-hidden />
                                  Export
                                </Button>
                              </>
                            }
                            onEdit={() =>
                              setEditingVeh({
                                id: v.id,
                                unit: v.unit,
                                vehicleType: v.vehicleType,
                                plate: v.plate,
                                makeModel: v.makeModel,
                                ownershipType: v.ownershipType,
                                projectId: v.projectId,
                              })
                            }
                            onDelete={() => removeVeh.mutate({ id: v.id })}
                            deleting={removeVeh.isPending}
                            error={failed?.id === v.id ? failed.message : null}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </section>
        </>
      )}
    </div>
  );
}
