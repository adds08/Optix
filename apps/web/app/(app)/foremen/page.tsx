"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChevronDown, HardHat, MapPin, Truck, Wrench } from "lucide-react";
import { CUSTODIAN_ROLES, formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { ToolIcon } from "@/components/sti/tool-icon";
import { useJobScope } from "@/components/job-scope";
import { money } from "@/lib/format";

/*
  One card per foreman — the answer to "who is on which job, what are they
  driving, and what's in the back".

  Each card shows the foreman, their truck, the trailer hitched to it, and the
  job site (a project — Urban does not run a separate "location", the project
  carries it). The tool count is on the card; the tools themselves are behind
  an accordion, because nobody needs forty rows in their face to know Miguel is
  on Legacy West with the TRU-001.

  A foreman's tools are the ones in their custody plus the ones physically in
  their truck and trailer — same tool, same place, counted once.
*/

type AssetRow = {
  id: string;
  tag: string | null;
  make?: string | null;
  modelNumber?: string | null;
  description?: string | null;
  categoryName?: string | null;
  status?: string | null;
  acquisitionCost?: string | null;
  custodianId?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  currentProjectId?: string | null;
};

export default function ForemenPage() {
  const employees = trpc.employee.list.useQuery();
  const vehicles = trpc.vehicle.list.useQuery();
  const assets = trpc.asset.list.useQuery();
  const projects = trpc.project.list.useQuery();

  const projectById = useMemo(
    () => new Map((projects.data ?? []).map((p) => [p.id, p])),
    [projects.data],
  );

  /* A scoped user sees only the tools on their jobs. */
  const { projectIds: scopeProjects } = useJobScope();

  const cards = useMemo(() => {
    const vehs = vehicles.data ?? [];
    const tools = assets.data ?? [];

    /* Foremen with a current job, or who hold anything, or drive anything. A
       newly added foreman with no post yet still needs a card. */
    const foremen = (employees.data ?? []).filter(
      (e) =>
        e.employmentStatus === "active" &&
        CUSTODIAN_ROLES.includes(e.role as (typeof CUSTODIAN_ROLES)[number]),
    );

    return foremen.map((f) => {
      const trucks = vehs.filter((v) => v.vehicleType === "truck" && v.foremanEmployeeId === f.id);
      const truckIds = new Set(trucks.map((t) => t.id));
      const trailers = vehs.filter(
        (v) =>
          v.vehicleType === "trailer" &&
          (v.foremanEmployeeId === f.id ||
            (v.attachedToVehicleId && truckIds.has(v.attachedToVehicleId))),
      );

      const containerLocIds = new Set<string>();
      for (const v of [...trucks, ...trailers]) {
        if (v.locationId) containerLocIds.add(v.locationId);
      }

      const held = tools.filter(
        (a: AssetRow) =>
          (a.custodianId === f.id || (a.locationId ? containerLocIds.has(a.locationId) : false)) &&
          (!scopeProjects || (a.currentProjectId ? scopeProjects.has(a.currentProjectId) : false)),
      );
      held.sort((a, b) => (a.tag ?? "").localeCompare(b.tag ?? ""));

      const proj = f.primaryProjectId ? projectById.get(f.primaryProjectId) : null;

      return {
        id: f.id,
        name: f.name,
        role: f.role,
        projectName: f.primaryProjectName,
        projectExternalId: proj?.externalId ?? null,
        trucks,
        trailers,
        held,
      };
    });
  }, [employees.data, vehicles.data, assets.data, projectById, scopeProjects]);

  const totalTools = cards.reduce((n, c) => n + c.held.length, 0);

  return (
    <div className="flex flex-col gap-6">
      {employees.isLoading || vehicles.isLoading || assets.isLoading ? (
        <TableSkeleton cols={4} />
      ) : employees.isError || vehicles.isError || assets.isError ? (
        <ErrorNote message="The foremen view could not be loaded. Check that the API is running, then reload." />
      ) : !cards.length ? (
        <EmptyState
          icon={HardHat}
          title="No foremen registered"
          description="Add foremen under People, then assign them a truck on Locations."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            <span className="tnum font-medium text-foreground">{cards.length}</span> foremen carrying{" "}
            <span className="tnum font-medium text-foreground">{totalTools}</span> tools.
          </p>

          <div className="flex flex-col gap-3">
            {cards.map((c) => (
              <details
                key={c.id}
                className="group overflow-hidden rounded-md border bg-card transition-colors open:border-foreground/25"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  {/* Name + job site */}
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                      {c.name
                        .split(" ")
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" aria-hidden />
                        {c.projectName ?? "No job assigned"}
                        {c.projectExternalId ? (
                          <span className="text-muted-foreground/70">· {c.projectExternalId}</span>
                        ) : null}
                      </span>
                    </span>
                  </span>

                  {/* Truck */}
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Truck className="size-3.5" aria-hidden />
                    {c.trucks.length ? (
                      <Tag>{c.trucks.map((t) => t.unit).join(", ")}</Tag>
                    ) : (
                      <span>no truck</span>
                    )}
                  </span>

                  {/* Trailer */}
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Wrench className="size-3.5" aria-hidden />
                    {c.trailers.length ? (
                      <Tag>{c.trailers.map((t) => t.unit).join(", ")}</Tag>
                    ) : (
                      <span>no trailer</span>
                    )}
                  </span>

                  {/* Tool count */}
                  <span className="ml-auto flex items-center gap-2">
                    <span className="rounded-md border bg-muted/50 px-2 py-0.5 text-xs">
                      <span className="tnum font-semibold text-foreground">{c.held.length}</span>{" "}
                      tool{c.held.length === 1 ? "" : "s"}
                      {c.held.some((a) => a.acquisitionCost) ? (
                        <span className="ml-1.5 tnum text-muted-foreground">
                          · {money(c.held.reduce((n, a) => n + (Number(a.acquisitionCost) || 0), 0))}
                        </span>
                      ) : null}
                    </span>
                    <ChevronDown
                      className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </span>
                </summary>

                <div className="border-t">
                  {c.held.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            {["Tag", "Tool", "Status", "Where", "Value"].map((h, i) => (
                              <th
                                key={h}
                                className={`label-xs px-4 py-2 ${i >= 3 ? "text-right" : "text-left"}`}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {c.held.map((a) => (
                            <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40">
                              <td className="px-4 py-2">
                                <Link href={`/tools/${a.id}`} className="hover:underline">
                                  <Tag>{a.tag ?? "Untagged"}</Tag>
                                </Link>
                              </td>
                              <td className="px-4 py-2">
                                <Link
                                  href={`/tools/${a.id}`}
                                  className="flex items-center gap-2 font-medium hover:underline"
                                >
                                  <ToolIcon
                                    category={a.categoryName}
                                    className="size-4 shrink-0 text-muted-foreground"
                                  />
                                  <span>{formatAssetModel(a) || "No description"}</span>
                                </Link>
                              </td>
                              <td className="px-4 py-2">
                                <StatusPill status={a.status} />
                              </td>
                              <td className="px-4 py-2 text-muted-foreground">
                                {a.locationName ?? "—"}
                              </td>
                              <td className="px-4 py-2 text-right tnum text-muted-foreground">
                                {money(a.acquisitionCost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="px-4 py-4 text-sm text-muted-foreground">
                      Holding nothing right now.
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
