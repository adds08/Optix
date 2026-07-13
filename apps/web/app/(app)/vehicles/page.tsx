"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Can } from "@/components/can";
import { VehicleForm } from "@/components/vehicle-form";

export default function VehiclesPage() {
  const vehicles = trpc.vehicle.list.useQuery();
  const [showForm, setShowForm] = useState(false);

  return (
    <><div className="card"><h2>Vehicles (Trucks &amp; Trailers)</h2><div className="toolbar">
      <Can perm="vehicle.manage">
        <button className="btn btn-sm" onClick={() => setShowForm(true)}>+ New Vehicle</button>
      </Can>
    </div><div className="body scroll">
      <table><thead><tr><th>Unit</th><th>Type</th><th>Make/Model</th><th>Plate</th><th>Ownership</th><th>Foreman</th><th>Project</th><th>GPS</th><th>Allowance</th></tr></thead>
        <tbody>
          {vehicles.data?.map((v) => (
            <tr key={v.id}>
              <td><b>{v.unit}</b></td><td>{v.vehicleType}</td><td>{v.makeModel ?? "—"}</td><td>{v.plate ?? "—"}</td>
              <td><span className={`chip ${v.ownershipType === "personal_allowance" ? "overdue" : "available"}`}>{v.ownershipType.replace("_", " ")}</span></td>
              <td>{v.foremanName ?? "—"}</td><td>{v.projectName ?? "—"}</td>
              <td>{v.gpsLat ? `${v.gpsLat}, ${v.gpsLng}` : <span className="muted">—</span>}</td>
              <td>{v.ownershipType === "personal_allowance" ? `${v.allowanceRate ?? ""}/${v.allowanceFrequency ?? ""}` : "—"}</td>
            </tr>
          ))}
          {!vehicles.data?.length && <tr><td colSpan={9} className="muted" style={{ padding: 14 }}>No vehicles</td></tr>}
        </tbody>
      </table>
    </div></div>
      <VehicleForm open={showForm} onClose={() => setShowForm(false)} />
    </>
  );
}
